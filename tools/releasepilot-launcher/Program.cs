using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

namespace ReleasePilot.Launcher
{
    internal static class Program
    {
        private static string FindWorkspaceRoot()
        {
            string[] candidates =
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Environment.CurrentDirectory
            };

            foreach (string candidate in candidates)
            {
                DirectoryInfo directory = new DirectoryInfo(candidate);
                for (int i = 0; directory != null && i < 8; i += 1)
                {
                    string launcher = Path.Combine(directory.FullName, "start-jazz-scheduler.ps1");
                    string dashboard = Path.Combine(directory.FullName, "outputs", "jazz-content-scheduler", "index.html");
                    if (File.Exists(launcher) && File.Exists(dashboard))
                    {
                        return directory.FullName;
                    }

                    directory = directory.Parent;
                }
            }

            return null;
        }

        private static void ShowError(string message)
        {
            string temp = Path.Combine(Path.GetTempPath(), "releasepilot-launch-error-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt");
            File.WriteAllText(temp, message, Encoding.UTF8);
            Process.Start(new ProcessStartInfo
            {
                FileName = "notepad.exe",
                Arguments = "\"" + temp + "\"",
                UseShellExecute = true
            });
        }

        [STAThread]
        private static void Main()
        {
            try
            {
                string root = FindWorkspaceRoot();
                if (string.IsNullOrWhiteSpace(root))
                {
                    ShowError("ReleasePilot could not find start-jazz-scheduler.ps1. Keep ReleasePilot.exe inside the ReleasePilot project folder, or place it beside start-jazz-scheduler.ps1.");
                    return;
                }

                string script = Path.Combine(root, "start-jazz-scheduler.ps1");
                Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-ExecutionPolicy Bypass -NoProfile -File \"" + script + "\"",
                    WorkingDirectory = root,
                    UseShellExecute = true,
                    WindowStyle = ProcessWindowStyle.Normal
                });
            }
            catch (Exception ex)
            {
                ShowError("ReleasePilot could not start.\r\n\r\n" + ex.Message);
            }
        }
    }
}
