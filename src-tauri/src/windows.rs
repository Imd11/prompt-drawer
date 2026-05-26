use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const BUTTON_WINDOW_LABEL: &str = "prompt-button";
pub const POPOVER_WINDOW_LABEL: &str = "prompt-popover";

#[derive(serde::Serialize)]
pub struct PromptButtonPosition {
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub fn prompt_button_position_cmd(app: tauri::AppHandle) -> Result<Option<PromptButtonPosition>, String> {
    let Some(window) = app.get_webview_window(BUTTON_WINDOW_LABEL) else {
        return Ok(None);
    };
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().unwrap_or(1.0);
    Ok(Some(PromptButtonPosition {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
    }))
}

#[tauri::command]
pub fn move_prompt_button_to(x: f64, y: f64, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUTTON_WINDOW_LABEL) {
        window
            .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_prompt_button(x: f64, y: f64, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUTTON_WINDOW_LABEL) {
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 })).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        crate::macos_panels::configure_non_activating_panel(&window)?;
        Ok(())
    } else {
        let window = WebviewWindowBuilder::new(&app, BUTTON_WINDOW_LABEL, WebviewUrl::App("overlay.html".into()))
            .title("Prompt Button")
            .inner_size(32.0, 32.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .position(x, y)
            .build()
            .map_err(|e| e.to_string())?;
        crate::macos_panels::configure_non_activating_panel(&window)?;
        Ok(())
    }
}

#[tauri::command]
pub fn hide_prompt_button(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUTTON_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn show_prompt_popover(x: f64, y: f64, app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: x as i32, y: y as i32 })).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        crate::macos_panels::configure_non_activating_panel(&window)?;
        Ok(())
    } else {
        let window = WebviewWindowBuilder::new(&app, POPOVER_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("Prompt Picker")
            .inner_size(320.0, 400.0)
            .resizable(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .position(x, y)
            .build()
            .map_err(|e| e.to_string())?;
        crate::macos_panels::configure_non_activating_panel(&window)?;
        Ok(())
    }
}

#[tauri::command]
pub fn hide_prompt_popover(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}