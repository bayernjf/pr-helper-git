// PR Helper Git — Tauri desktop wrapper.
// Spawns the Node.js server on an ephemeral port (with fnm/nvm/homebrew fallback),
// opens a webview against it, provides a system tray (open/quit) and
// guarantees the server child dies with the app.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct ServerProcess(Mutex<Option<Child>>);

fn find_node() -> Option<String> {
    for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    let output = Command::new("zsh")
        .args(["-l", "-c", "which node"])
        .output()
        .ok()?;
    let p = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if p.is_empty() { None } else { Some(p) }
}

/// Spawn the Node server with `--port=0` (OS picks a free port, so the desktop
/// app never collides with a `npm start` server) and wait — bounded — for the
/// `PR_HELPER_PORT=<n>` line it prints once listening.
fn spawn_server(app: &tauri::AppHandle) -> Result<(Child, u16), String> {
    let node = find_node().ok_or("Node.js not found on this system")?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?;
    let server_script = resource_dir.join("_up_/server/index.mjs");
    if !server_script.exists() {
        return Err(format!("server script not found: {}", server_script.display()));
    }
    let mut child = Command::new(&node)
        .arg(&server_script)
        .arg("--port=0")
        .env("PR_HELPER_DESKTOP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    let stdout = child.stdout.take().ok_or("server stdout unavailable")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() { break; }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("server did not report a port within 15s".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => return Err(format!("server exited early: {status}")),
            Ok(None) => {}
            Err(e) => return Err(format!("server status: {e}")),
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Some(port) = line.strip_prefix("PR_HELPER_PORT=") {
                    let port: u16 = port
                        .trim()
                        .parse()
                        .map_err(|_| format!("bad port line from server: {line}"))?;
                    return Ok((child, port));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("server stdout closed before reporting a port".into());
            }
        }
    }
}

fn show_or_focus_window(app: &tauri::AppHandle, port: u16) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window("main") {
        existing.show()?;
        existing.set_focus()?;
        return Ok(());
    }
    let url: tauri::Url = format!("http://127.0.0.1:{port}/?token=desktop-internal")
        .parse()
        .expect("static localhost URL is always valid");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("PR Helper Git")
        .inner_size(1400.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .center()
        .build()?;
    Ok(())
}

/// Native macOS dialog for fatal startup errors (no extra dependencies).
fn fatal_alert(message: &str) {
    let escaped = message.replace('\\', "\\\\").replace('"', "\\\"");
    let _ = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "display dialog \"{escaped}\" with title \"PR Helper Git\" buttons {{\"OK\"}} default button 1 with icon stop"
        ))
        .status();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let app = app.handle().clone();
            let (child, port) = match spawn_server(&app) {
                Ok(ok) => ok,
                Err(e) => {
                    eprintln!("[pr-helper-git] server spawn failed: {e}");
                    fatal_alert(&format!("启动内置服务失败 / Failed to start the local server:\n\n{e}"));
                    app.exit(1);
                    return Ok(());
                }
            };
            *app.state::<ServerProcess>().0.lock().unwrap() = Some(child);

            if let Err(e) = show_or_focus_window(&app, port) {
                eprintln!("[pr-helper-git] window create failed: {e}");
                fatal_alert(&format!("无法创建主窗口 / Failed to create the main window:\n\n{e}"));
                app.exit(1);
                return Ok(());
            }

            let open_item = MenuItem::with_id(&app, "open", "打开 PR Helper Git", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(&app, "quit", "退出 / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(&app, &[&open_item, &quit_item])?;
            let _tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("PR Helper Git")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(&app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window hides it — the tray keeps the app alive.
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // The server child must never outlive the app (it would keep
            // holding its port as an orphan).
            tauri::RunEvent::Exit => {
                if let Some(mut child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // macOS dock-icon click with no visible window → reopen it.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            _ => {}
        });
}
