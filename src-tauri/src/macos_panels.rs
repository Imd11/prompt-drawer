#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSFloatingWindowLevel, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask,
};

#[cfg(target_os = "macos")]
pub fn configure_non_activating_panel(window: &tauri::WebviewWindow) -> Result<(), String> {
    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("ns_window returned null".to_string());
    }

    unsafe {
        let ns_window = &*(ns_window_ptr.cast::<NSWindow>());
        let mask = ns_window.styleMask()
            | NSWindowStyleMask::NonactivatingPanel
            | NSWindowStyleMask::UtilityWindow;
        ns_window.setStyleMask(mask);
        ns_window.setLevel(NSFloatingWindowLevel);
        ns_window.setCanHide(false);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setIgnoresMouseEvents(false);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_non_activating_panel(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
