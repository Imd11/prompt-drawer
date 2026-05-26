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

pub fn accessibility_status() -> AccessibilityStatus {
    AccessibilityStatus { trusted: false }
}

pub fn frontmost_app() -> Option<FrontmostApp> {
    None
}

fn copy_to_clipboard(body: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }

    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn paste_prompt(body: &str) -> Result<(), String> {
    copy_to_clipboard(body)?;

    // Simulate Cmd+V using osascript
    Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to keystroke \"v\" using command down"])
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn paste_prompt_to_app(body: &str, bundle_id: &str) -> Result<(), String> {
    copy_to_clipboard(body)?;

    let script = format!(
        r#"
tell application id "{bundle_id}" to activate
delay 0.05
tell application "System Events" to keystroke "v" using command down
"#
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}