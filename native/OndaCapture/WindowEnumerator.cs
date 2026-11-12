using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace OndaCapture;

internal static class WindowEnumerator
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public static WindowSnapshot Snapshot()
    {
        var titles = new Dictionary<int, string>();
        var visiblePids = new HashSet<int>();
        var foregroundPid = 0;
        var foreground = GetForegroundWindow();

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd))
            {
                return true;
            }

            var length = GetWindowTextLength(hWnd);
            if (length <= 0)
            {
                return true;
            }

            GetWindowThreadProcessId(hWnd, out var pid);
            if (pid == 0)
            {
                return true;
            }

            var builder = new StringBuilder(length + 1);
            GetWindowText(hWnd, builder, builder.Capacity);
            var title = builder.ToString().Trim();
            if (title.Length == 0)
            {
                return true;
            }

            visiblePids.Add((int)pid);
            if (!titles.TryGetValue((int)pid, out var existing) || title.Length > existing.Length)
            {
                titles[(int)pid] = title;
            }

            if (hWnd == foreground)
            {
                foregroundPid = (int)pid;
            }

            return true;
        }, IntPtr.Zero);

        return new WindowSnapshot(titles, visiblePids, foregroundPid);
    }

    public static int GetProcessIdForWindow(int windowHandle)
    {
        GetWindowThreadProcessId(new IntPtr(windowHandle), out var pid);
        return (int)pid;
    }

    public static string GetProcessName(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return process.ProcessName;
        }
        catch
        {
            return string.Empty;
        }
    }

    internal sealed class WindowSnapshot
    {
        public WindowSnapshot(
            Dictionary<int, string> titles,
            HashSet<int> visiblePids,
            int foregroundPid)
        {
            Titles = titles;
            VisiblePids = visiblePids;
            ForegroundPid = foregroundPid;
        }

        public Dictionary<int, string> Titles { get; }
        public HashSet<int> VisiblePids { get; }
        public int ForegroundPid { get; }
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
}
