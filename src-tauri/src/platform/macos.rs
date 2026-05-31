#![cfg(target_os = "macos")]

use serde::Serialize;
use std::io::Write;
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
pub struct FrontmostApp {
    pub name: String,
    pub bundle_id: String,
}

#[derive(Debug, Serialize)]
pub struct AccessibilityStatus {
    pub trusted: bool,
}

// ── Accessibility ──────────────────────────────────────────────────────────────

pub fn accessibility_status() -> AccessibilityStatus {
    AccessibilityStatus {
        trusted: is_accessibility_trusted(),
    }
}

fn is_accessibility_trusted() -> bool {
    // Use sysctl to check if we have assistive access
    let output = Command::new("sysctl")
        .args(["-n", "ai举证"]) // intentionally wrong to fall through
        .output();

    // Try the modern way: defaults read
    let output = Command::new("defaults")
        .args(["read", "com.apple.security Accessibility"])
        .output();

    if let Ok(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        if s.contains("1") {
            return true;
        }
    }

    // AXIsProcessTrusted is the canonical check
    unsafe { ax_is_process_trusted() }
}

// Raw FFI for AXIsProcessTrusted
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

fn ax_is_process_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

// ── Frontmost App ─────────────────────────────────────────────────────────────

pub fn frontmost_app() -> Option<FrontmostApp> {
    frontmost_app_info().map(|info| info.app)
}

struct FrontmostAppInfo {
    app: FrontmostApp,
    pid: u32,
}

fn frontmost_app_info() -> Option<FrontmostAppInfo> {
    // Get frontmost app via lsappinfo
    let output = Command::new("lsappinfo")
        .args(["front"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();

    // Parse "LSAppServiceFrontmost_Process = ..." or "pid:123"
    let pid = if let Some(start) = trimmed.find("pid:") {
        trimmed[start + 4..].split_whitespace().next()?.parse().ok()?
    } else if let Some(eq) = trimmed.find(" = ") {
        let val = &trimmed[eq + 3..];
        val.split_whitespace().next()?.trim_matches('"').parse().ok()?
    } else {
        return None;
    };

    // Get app name and bundle id via lsappinfo
    let info_output = Command::new("lsappinfo")
        .args(["info", "-app", &format!("{}", pid)])
        .output()
        .ok()?;

    let info_stdout = String::from_utf8_lossy(&info_output.stdout);
    let info_trimmed = info_stdout.trim();

    let name = extract_lsappinfo_field(info_trimmed, "CFBundleName")
        .or_else(|| extract_lsappinfo_field(info_trimmed, "LSApplicationName"))
        .unwrap_or_else(|| "Unknown".to_string());

    let bundle_id = extract_lsappinfo_field(info_trimmed, "CFBundleIdentifier")
        .unwrap_or_else(|| format!("unknown.{}", pid));

    Some(FrontmostAppInfo {
        app: FrontmostApp { name, bundle_id },
        pid,
    })
}

fn extract_lsappinfo_field(s: &str, key: &str) -> Option<String> {
    // Format: "key = \"value\"" or "key:value"
    for line in s.lines() {
        let line = line.trim();
        if line.starts_with(key) {
            if let Some(eq) = line.find('=') {
                let val = line[eq + 1..].trim().trim_matches('"').trim_matches('\'');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            } else if let Some(col) = line.find(':') {
                let val = line[col + 1..].trim().trim_matches('"').trim_matches('\'');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

// ── Current Input Target ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct InputTarget {
    pub frame: CandidateInput,
    pub window_frame: CandidateInput,
    pub button_position: (f64, f64),
    pub app: Option<FrontmostApp>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CandidateInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn current_input_target() -> Option<InputTarget> {
    let app_info = frontmost_app_info()?;

    // Exclude Prompt Picker itself
    if app_info.app.bundle_id == "local.promptpicker.dev"
        || app_info.app.name == "Prompt Picker"
    {
        return None;
    }

    // Use accessibility API to get focused element of frontmost app
    get_focused_input_element(app_info.pid, app_info.app.clone())
}

fn get_focused_input_element(pid: u32, app: FrontmostApp) -> Option<InputTarget> {
    // Build osascript that returns "wx,wy|ww,wh|ex,ey|ew,eh"
    let script = format!(
        r#"on run
tell application "System Events"
    tell (first process whose unix id is {})
        set frontWin to front window
        set winPos to position of frontWin
        set winSize to size of frontWin
        set focusedElem to focused UI element of frontWin
        set elemPos to {{0, 0}}
        set elemSize to {{0, 0}}
        try
            set elemPos to position of focusedElem
            set elemSize to size of focusedElem
        end try
        return (item 1 of winPos as string) & "," & (item 2 of winPos as string) & "|" & (item 1 of winSize as string) & "," & (item 2 of winSize as string) & "|" & (item 1 of elemPos as string) & "," & (item 2 of elemPos as string) & "|" & (item 1 of elemSize as string) & "," & (item 2 of elemSize as string)
    end tell
end tell
end run"#,
        pid
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();

    // Parse "X|Y|W,H|X2|Y2|W2,H2"
    let parts: Vec<&str> = trimmed.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let window_pos = parse_xy(parts[1])?;
    let window_size = parse_xy(parts[2])?;
    let elem_pos = parse_xy(parts[3])?;
    let elem_size = parse_xy(parts[4])?;

    let window_frame = CandidateInput {
        x: window_pos.0,
        y: window_pos.1,
        width: window_size.0,
        height: window_size.1,
    };

    let frame = CandidateInput {
        x: elem_pos.0,
        y: elem_pos.1,
        width: elem_size.0,
        height: elem_size.1,
    };

    // Button position: bottom-right of input element
    let button_x = elem_pos.0 + elem_size.0;
    let button_y = elem_pos.1 + elem_size.1;

    Some(InputTarget {
        frame,
        window_frame,
        button_position: (button_x, button_y),
        app: Some(app),
    })
}

fn parse_xy(s: &str) -> Option<(f64, f64)> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 2 {
        return None;
    }
    let x: f64 = parts[0].trim().parse().ok()?;
    let y: f64 = parts[1].trim().parse().ok()?;
    Some((x, y))
}

// ── Paste ─────────────────────────────────────────────────────────────────────

pub fn paste_prompt(body: &str) -> Result<(), String> {
    copy_to_clipboard(body)?;

    Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn paste_prompt_to_app(body: &str, bundle_id: &str) -> Result<(), String> {
    copy_to_clipboard(body)?;

    let script = format!(
        r#"tell application id "{}" to activate
delay 0.05
tell application "System Events" to keystroke "v" using command down"#,
        bundle_id
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

fn copy_to_clipboard(body: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(body.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}
