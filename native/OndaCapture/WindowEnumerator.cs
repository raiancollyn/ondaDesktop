using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace OndaCapture;

internal static class WindowEnumerator
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const int GwlExStyle = -20;
    private const long WsExToolWindow = 0x00000080;
    private const long WsExAppWindow = 0x00040000;
    private const uint GwOwner = 4;
    private const int DwmwaCloaked = 14;

    public static WindowSnapshot Snapshot()
    {
        var titles = new Dictionary<int, string>();
        var visiblePids = new HashSet<int>();
        var windows = new List<WindowInfo>();
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

            var taskbar = IsTaskbarWindow(hWnd);
            windows.Add(new WindowInfo(hWnd.ToInt64(), (int)pid, title, taskbar));

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

        return new WindowSnapshot(titles, visiblePids, windows, foregroundPid);
    }

    private static bool IsTaskbarWindow(IntPtr hWnd)
    {
        var exStyle = GetWindowLongPtr(hWnd, GwlExStyle).ToInt64();
        var appWindow = (exStyle & WsExAppWindow) != 0;
        if ((exStyle & WsExToolWindow) != 0 && !appWindow)
        {
            return false;
        }

        var owner = GetWindow(hWnd, GwOwner);
        if (owner != IntPtr.Zero && !appWindow)
        {
            return false;
        }

        if (DwmGetWindowAttribute(hWnd, DwmwaCloaked, out var cloaked, sizeof(int)) == 0 && cloaked != 0)
        {
            return false;
        }

        return true;
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
            List<WindowInfo> windows,
            int foregroundPid)
        {
            Titles = titles;
            VisiblePids = visiblePids;
            Windows = windows;
            ForegroundPid = foregroundPid;
        }

        public Dictionary<int, string> Titles { get; }
        public HashSet<int> VisiblePids { get; }
        public List<WindowInfo> Windows { get; }
        public int ForegroundPid { get; }
    }

    internal sealed record WindowInfo(long Hwnd, int Pid, string Title, bool Taskbar);

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

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
}
