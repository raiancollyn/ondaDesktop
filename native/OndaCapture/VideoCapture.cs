using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace OndaCapture;

internal static class VideoCapture
{
    private const uint PwRenderFullContent = 2;
    private const uint Srccopy = 0x00CC0020;
    private const uint Captureblt = 0x40000000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static int Run(string[] args)
    {
        try
        {
            EnableDpiAwareness();

            var kind = (Program.ReadOption(args, "--kind") ?? "screen").ToLowerInvariant();
            var outputWidth = Math.Clamp(Program.ReadInt(args, "--out-width", 1280), 320, 1920);
            var outputHeight = Math.Clamp(Program.ReadInt(args, "--out-height", 720), 180, 1080);
            var fps = Math.Clamp(Program.ReadInt(args, "--fps", 15), 2, 30);
            var quality = Math.Clamp(Program.ReadInt(args, "--quality", 78), 40, 95);
            var durationSeconds = Program.ReadDouble(args, "--duration", 0);

            Rectangle sourceRect;
            var windowHandle = IntPtr.Zero;
            if (kind == "window")
            {
                var hwndValue = Program.ReadInt(args, "--hwnd", 0);
                if (hwndValue <= 0)
                {
                    Console.Error.WriteLine("--hwnd é obrigatório para captura de janela.");
                    return 2;
                }

                windowHandle = new IntPtr(hwndValue);
                if (!GetWindowRect(windowHandle, out var windowRect))
                {
                    Console.Error.WriteLine($"Não foi possível obter o retângulo da janela {hwndValue}.");
                    return 2;
                }

                // A captura GDI de fallback lê a região visível da tela. Trazer a
                // janela para frente evita compartilhar a janela do Onda por cima.
                if (IsIconic(windowHandle))
                {
                    ShowWindow(windowHandle, 9);
                }
                SetForegroundWindow(windowHandle);
                Thread.Sleep(200);

                if (!GetWindowRect(windowHandle, out windowRect))
                {
                    Console.Error.WriteLine($"Não foi possível reler o retângulo da janela {hwndValue}.");
                    return 2;
                }

                sourceRect = Rectangle.FromLTRB(
                    windowRect.Left,
                    windowRect.Top,
                    windowRect.Right,
                    windowRect.Bottom);
            }
            else
            {
                sourceRect = new Rectangle(
                    Program.ReadInt(args, "--x", 0),
                    Program.ReadInt(args, "--y", 0),
                    Math.Max(1, Program.ReadInt(args, "--width", outputWidth)),
                    Math.Max(1, Program.ReadInt(args, "--height", outputHeight)));
            }

            if (sourceRect.Width < 2 || sourceRect.Height < 2)
            {
                Console.Error.WriteLine("Área de captura inválida.");
                return 2;
            }

            var stdout = Console.OpenStandardOutput();
            var header = JsonSerializer.Serialize(new
            {
                type = "video-started",
                kind,
                width = outputWidth,
                height = outputHeight,
                fps,
                format = "jpeg"
            }, JsonOptions);
            var headerBytes = Encoding.UTF8.GetBytes(header + "\n");
            stdout.Write(headerBytes);
            stdout.Flush();

            using var encoderParameters = new EncoderParameters(1);
            encoderParameters.Param[0] = new EncoderParameter(
                System.Drawing.Imaging.Encoder.Quality,
                (long)quality);
            var jpegEncoder = ImageCodecInfo.GetImageEncoders()
                .First(codecInfo => codecInfo.FormatID == ImageFormat.Jpeg.Guid);

            var stop = false;
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                stop = true;
            };

            var deadline = durationSeconds > 0
                ? DateTime.UtcNow.AddSeconds(durationSeconds)
                : DateTime.MaxValue;
            Span<byte> lengthBytes = stackalloc byte[4];
            using var screenTarget = new Bitmap(outputWidth, outputHeight, PixelFormat.Format24bppRgb);
            var stats = args.Contains("--stats", StringComparer.OrdinalIgnoreCase);
            var captureTicks = 0L;
            var encodeTicks = 0L;
            var frameCount = 0;

            while (!stop && DateTime.UtcNow < deadline)
            {
                var captureWatch = Stopwatch.StartNew();
                byte[]? encoded = null;
                var frame = (Bitmap?)null;
                var jpegStream = (MemoryStream?)null;

                try
                {
                    if (kind == "window")
                    {
                        using var source = CaptureWindow(windowHandle, sourceRect);
                        frame = ResizeFrame(source, outputWidth, outputHeight);
                    }
                    else
                    {
                        CaptureScreenToTarget(sourceRect, screenTarget);
                        frame = screenTarget;
                    }

                    captureWatch.Stop();
                    captureTicks += captureWatch.ElapsedTicks;
                    frameCount++;

                    var encodeWatch = Stopwatch.StartNew();
                    jpegStream = new MemoryStream();
                    frame.Save(jpegStream, jpegEncoder, encoderParameters);
                    encoded = jpegStream.ToArray();
                    encodeWatch.Stop();
                    encodeTicks += encodeWatch.ElapsedTicks;
                }
                finally
                {
                    jpegStream?.Dispose();
                    if (kind == "window")
                    {
                        frame?.Dispose();
                    }
                }

                if (encoded is not null)
                {
                    WriteFrame(stdout, lengthBytes, encoded);
                }

                if (stats && frameCount % 30 == 0)
                {
                    var captureMs = captureTicks * 1000.0 / Stopwatch.Frequency / frameCount;
                    var encodeMs = encodeTicks * 1000.0 / Stopwatch.Frequency / frameCount;
                    Console.Error.WriteLine(
                        $"stats frame={frameCount} capture={captureMs:F1}ms encode={encodeMs:F1}ms");
                }
            }

            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Falha na captura de vídeo: {exception}");
            return 1;
        }
    }

    private static void WriteFrame(Stream stdout, Span<byte> lengthBytes, byte[] jpeg)
    {
        BitConverter.TryWriteBytes(lengthBytes, jpeg.Length);
        stdout.Write(lengthBytes);
        stdout.Write(jpeg);
        stdout.Flush();
    }

    private static void CaptureScreenToTarget(Rectangle sourceRect, Bitmap target)
    {
        using var graphics = Graphics.FromImage(target);
        var destinationDc = graphics.GetHdc();
        var sourceDc = GetDC(IntPtr.Zero);
        try
        {
            SetStretchBltMode(destinationDc, 3);
            StretchBlt(
                destinationDc,
                0,
                0,
                target.Width,
                target.Height,
                sourceDc,
                sourceRect.Left,
                sourceRect.Top,
                sourceRect.Width,
                sourceRect.Height,
                Srccopy | Captureblt);
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, sourceDc);
            graphics.ReleaseHdc(destinationDc);
        }
    }

    private static Bitmap CaptureWindow(IntPtr windowHandle, Rectangle sourceRect)
    {
        var bitmap = new Bitmap(sourceRect.Width, sourceRect.Height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(bitmap);
        var destinationDc = graphics.GetHdc();
        var printed = false;

        try
        {
            printed = PrintWindow(windowHandle, destinationDc, PwRenderFullContent);
            if (!printed)
            {
                var sourceDc = GetWindowDC(windowHandle);
                try
                {
                    printed = BitBlt(
                        destinationDc,
                        0,
                        0,
                        sourceRect.Width,
                        sourceRect.Height,
                        sourceDc,
                        0,
                        0,
                        Srccopy | Captureblt);
                }
                finally
                {
                    ReleaseDC(windowHandle, sourceDc);
                }
            }
        }
        finally
        {
            graphics.ReleaseHdc(destinationDc);
        }

        if (!printed)
        {
            Console.Error.WriteLine("A captura da janela retornou falso; usando a região visível da tela.");
        }

        if (!printed || IsMostlyBlack(bitmap))
        {
            try
            {
                using var fallbackGraphics = Graphics.FromImage(bitmap);
                fallbackGraphics.CopyFromScreen(
                    sourceRect.Left,
                    sourceRect.Top,
                    0,
                    0,
                    sourceRect.Size,
                    CopyPixelOperation.SourceCopy);
            }
            catch (Exception exception)
            {
                Console.Error.WriteLine($"Também não foi possível copiar a região da janela: {exception.Message}");
            }
        }

        return bitmap;
    }

    private static bool IsMostlyBlack(Bitmap bitmap)
    {
        var bright = 0;
        var total = 0;
        var stepX = Math.Max(1, bitmap.Width / 24);
        var stepY = Math.Max(1, bitmap.Height / 16);

        for (var y = 0; y < bitmap.Height; y += stepY)
        {
            for (var x = 0; x < bitmap.Width; x += stepX)
            {
                var pixel = bitmap.GetPixel(x, y);
                total++;
                if (pixel.R + pixel.G + pixel.B > 24)
                {
                    bright++;
                }
            }
        }

        return total == 0 || bright < Math.Max(2, total / 100);
    }

    private static Bitmap ResizeFrame(Bitmap source, int width, int height)
    {
        var frame = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using var graphics = Graphics.FromImage(frame);
        graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
        graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        graphics.DrawImage(source, 0, 0, width, height);
        return frame;
    }

    private static void EnableDpiAwareness()
    {
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
                // Best effort only.
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindowDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDc);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("gdi32.dll")]
    private static extern int SetStretchBltMode(IntPtr hdc, int mode);

    [DllImport("gdi32.dll")]
    private static extern bool StretchBlt(
        IntPtr hdcDest,
        int xDest,
        int yDest,
        int widthDest,
        int heightDest,
        IntPtr hdcSrc,
        int xSrc,
        int ySrc,
        int widthSrc,
        int heightSrc,
        uint rop);

    [DllImport("gdi32.dll")]
    private static extern bool BitBlt(
        IntPtr hdcDest,
        int xDest,
        int yDest,
        int width,
        int height,
        IntPtr hdcSrc,
        int xSrc,
        int ySrc,
        uint rop);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
}
