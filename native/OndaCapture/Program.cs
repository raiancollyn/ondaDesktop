using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using ApplicationLoopback.NET;
using NAudio.CoreAudioApi;

namespace OndaCapture;

internal static class Program
{
    private const int SampleRate = 48_000;
    private const int Channels = 2;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || args.Contains("--help", StringComparer.OrdinalIgnoreCase))
            {
                Console.Title = "OndaCapture — componente de áudio";
                WriteHelp();
                WriteLauncherNotice();
                if (args.Length == 0)
                {
                    PauseIfInteractive();
                }
                return args.Length == 0 ? 2 : 0;
            }

            if (args.Contains("--list", StringComparer.OrdinalIgnoreCase))
            {
                WriteProcessList();
                return 0;
            }

            if (args.Contains("--window-pid", StringComparer.OrdinalIgnoreCase))
            {
                var hwnd = ReadInt(args, "--hwnd", 0);
                var pid = hwnd > 0 ? WindowEnumerator.GetProcessIdForWindow(hwnd) : 0;
                var payload = JsonSerializer.Serialize(new
                {
                    pid,
                    name = pid > 0 ? WindowEnumerator.GetProcessName(pid) : string.Empty
                }, JsonOptions);
                var output = Console.OpenStandardOutput();
                output.Write(Encoding.UTF8.GetBytes(payload));
                output.Flush();
                return pid > 0 ? 0 : 2;
            }

            if (args.Contains("--capture", StringComparer.OrdinalIgnoreCase))
            {
                return await RunCaptureAsync(args);
            }

            if (args.Contains("--video", StringComparer.OrdinalIgnoreCase))
            {
                return VideoCapture.Run(args);
            }

            Console.Error.WriteLine("Comando inválido. Use --list, --capture ou --help.");
            return 2;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    private static void WriteHelp()
    {
        Console.Error.WriteLine("""
            OndaCapture — captura de áudio por processo no Windows.

            Uso:
              OndaCapture --list
              OndaCapture --window-pid --hwnd <hwnd>
              OndaCapture --capture --pid <pid> --mode include|exclude [--output arquivo.raw] [--duration segundos]
              OndaCapture --capture --system [--output arquivo.raw] [--duration segundos]
              OndaCapture --video --kind screen --x <x> --y <y> --width <w> --height <h> [--fps 15]
              OndaCapture --video --kind window --hwnd <hwnd> [--fps 15]

            Saída de --capture:
              uma linha JSON de cabeçalho seguida de PCM float32 little-endian,
              intercalado em 48 kHz e 2 canais.

            Saída de --video:
              uma linha JSON de cabeçalho seguida de quadros JPEG, cada um
              prefixado por um inteiro little-endian de 4 bytes com o tamanho.
            """);
    }

    private static void WriteLauncherNotice()
    {
        Console.Error.WriteLine();
        Console.Error.WriteLine("OndaCapture é o componente nativo de captura de áudio.");
        Console.Error.WriteLine("Ele não abre a interface do Onda.");
        Console.Error.WriteLine("Para abrir o aplicativo, execute `iniciar-onda.cmd` na pasta desktop");
        Console.Error.WriteLine("ou rode `npm start` nessa pasta.");
    }

    private static void PauseIfInteractive()
    {
        if (!Environment.UserInteractive || Console.IsInputRedirected)
        {
            return;
        }

        Console.Error.WriteLine();
        Console.Error.WriteLine("Pressione Enter para fechar...");
        Console.ReadLine();
    }

    private static void WriteProcessList()
    {
        var currentPid = Environment.ProcessId;
        var windows = WindowEnumerator.Snapshot();
        var processes = new List<ProcessEntry>();

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.Id == currentPid)
                {
                    continue;
                }

                string title;
                try
                {
                    title = process.MainWindowTitle?.Trim() ?? string.Empty;
                }
                catch
                {
                    title = string.Empty;
                }

                if (title.Length == 0 && windows.Titles.TryGetValue(process.Id, out var windowTitle))
                {
                    title = windowTitle;
                }

                processes.Add(new ProcessEntry(
                    process.Id,
                    process.ProcessName,
                    title,
                    windows.VisiblePids.Contains(process.Id),
                    windows.ForegroundPid == process.Id));
            }
            catch
            {
                // Processes can exit or deny access while enumerating.
            }
            finally
            {
                process.Dispose();
            }
        }

        var payload = JsonSerializer.Serialize(new
        {
            processes = processes
                .Where(entry => entry.Pid > 0)
                .OrderByDescending(entry => entry.Foreground)
                .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
                .ThenBy(entry => entry.Pid),
            audioSessions = ReadAudioSessions(),
            foregroundPid = windows.ForegroundPid
        }, JsonOptions);

        var output = Console.OpenStandardOutput();
        var bytes = Encoding.UTF8.GetBytes(payload);
        output.Write(bytes);
        output.Flush();
    }

    private static async Task<int> RunCaptureAsync(string[] args)
    {
        var systemAudio = args.Contains("--system", StringComparer.OrdinalIgnoreCase);
        if (!systemAudio && (!TryReadUInt(args, "--pid", out var requestedPid) || requestedPid == 0))
        {
            Console.Error.WriteLine("--pid é obrigatório (ou use --system para o áudio do sistema).");
            return 2;
        }

        var pid = systemAudio
            ? (uint)Environment.ProcessId
            : ReadOption(args, "--pid") is { } pidText ? uint.Parse(pidText) : 0;
        var modeText = ReadOption(args, "--mode") ?? "include";
        var mode = systemAudio || modeText.Equals("exclude", StringComparison.OrdinalIgnoreCase)
            ? CaptureMode.ExcludeProcessTree
            : CaptureMode.IncludeProcessTree;

        var durationSeconds = TryReadDouble(args, "--duration", out var duration) ? duration : 0;
        var outputPath = ReadOption(args, "--output");
        FileStream? fileOutput = null;

        if (!string.IsNullOrWhiteSpace(outputPath))
        {
            fileOutput = new FileStream(
                Path.GetFullPath(outputPath),
                FileMode.Create,
                FileAccess.Write,
                FileShare.Read);
        }

        using var capture = new ApplicationLoopbackCapture(Channels, SampleRate);
        var standardOutput = Console.OpenStandardOutput();
        var writeLock = new object();
        var stopped = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var cancelRequested = false;

        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancelRequested = true;
            stopped.TrySetResult(true);
        };

        capture.NewDataAvailable += data =>
        {
            try
            {
                var bytes = MemoryMarshal.AsBytes(data);
                lock (writeLock)
                {
                    if (fileOutput is not null)
                    {
                        fileOutput.Write(bytes);
                        fileOutput.Flush();
                    }
                    else
                    {
                        standardOutput.Write(bytes);
                        standardOutput.Flush();
                    }
                }
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Falha ao escrever áudio: {exception.Message}");
                stopped.TrySetResult(true);
            }
        };

        capture.CaptureStopped += () => stopped.TrySetResult(true);

        try
        {
            var header = JsonSerializer.Serialize(new
            {
                type = "started",
                pid,
                mode = systemAudio
                    ? "system"
                    : mode == CaptureMode.ExcludeProcessTree ? "exclude" : "include",
                sampleRate = SampleRate,
                channels = Channels,
                format = "f32le"
            }, JsonOptions);

            var headerBytes = Encoding.UTF8.GetBytes(header + "\n");
            standardOutput.Write(headerBytes);
            standardOutput.Flush();

            capture.StartCapture(pid, mode);

            if (durationSeconds > 0)
            {
                await Task.WhenAny(stopped.Task, Task.Delay(TimeSpan.FromSeconds(durationSeconds)));
            }
            else
            {
                await stopped.Task;
            }

            if (!cancelRequested)
            {
                try
                {
                    await capture.StopCapture();
                }
                catch (InvalidOperationException)
                {
                    // Capture may already have stopped by itself.
                }
            }

            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Não foi possível capturar o processo {pid}: {exception.Message}");
            return 1;
        }
        finally
        {
            fileOutput?.Dispose();
        }
    }

    private static List<AudioSessionEntry> ReadAudioSessions()
    {
        var result = new List<AudioSessionEntry>();

        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var sessions = device.AudioSessionManager.Sessions;

            for (var index = 0; index < sessions.Count; index++)
            {
                try
                {
                    using var session = sessions[index];
                    var pid = unchecked((int)session.GetProcessID);
                    if (pid <= 0)
                    {
                        continue;
                    }

                    var processName = string.Empty;
                    try
                    {
                        using var process = Process.GetProcessById(pid);
                        processName = process.ProcessName;
                    }
                    catch
                    {
                        // The audio session can outlive the process that created it.
                    }

                    result.Add(new AudioSessionEntry(pid, processName, session.State.ToString()));
                }
                catch
                {
                    // A session can disappear while we enumerate.
                }
            }
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Não foi possível listar as sessões de áudio: {exception.Message}");
        }

        return result
            .GroupBy(entry => entry.Pid)
            .Select(group => group.First())
            .OrderBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();
    }

    internal static string? ReadOption(string[] args, string name)
    {
        for (var index = 0; index < args.Length - 1; index++)
        {
            if (args[index].Equals(name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return null;
    }

    internal static int ReadInt(string[] args, string name, int fallback)
    {
        var raw = ReadOption(args, name);
        return int.TryParse(raw, out var value) ? value : fallback;
    }

    internal static double ReadDouble(string[] args, string name, double fallback)
    {
        var raw = ReadOption(args, name);
        return double.TryParse(
            raw,
            System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture,
            out var value)
            ? value
            : fallback;
    }

    private static bool TryReadUInt(string[] args, string name, out uint value)
    {
        value = 0;
        var raw = ReadOption(args, name);
        return uint.TryParse(raw, out value);
    }

    private static bool TryReadDouble(string[] args, string name, out double value)
    {
        value = 0;
        var raw = ReadOption(args, name);
        return double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value);
    }

    private sealed record ProcessEntry(int Pid, string Name, string Title, bool HasWindow, bool Foreground);
    private sealed record AudioSessionEntry(int Pid, string Name, string State);
}
