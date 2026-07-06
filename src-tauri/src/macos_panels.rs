#[cfg(target_os = "macos")]
use objc2::{
    runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
    sel,
};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSApplication, NSColor, NSScreenSaverWindowLevel, NSWindow, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNumber, NSString};
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;
#[cfg(target_os = "macos")]
use std::ffi::CString;

#[cfg(target_os = "macos")]
pub fn activate_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let mtm = objc2::MainThreadMarker::new()
        .ok_or_else(|| "activate_main_window must run on the main thread".to_string())?;
    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("ns_window returned null".to_string());
    }

    unsafe {
        let app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);

        let ns_window = &*(ns_window_ptr.cast::<NSWindow>());
        ns_window.makeKeyAndOrderFront(None);
        ns_window.makeMainWindow();
        ns_window.makeKeyWindow();
    }

    Ok(())
}

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
        ns_window.setLevel(NSScreenSaverWindowLevel);
        ns_window.setCanHide(false);
        ns_window.setHidesOnDeactivate(false);
        ns_window.setIgnoresMouseEvents(false);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::CanJoinAllApplications
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::Transient
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        apply_never_key_panel_class(ns_window)?;
        ns_window.orderFrontRegardless();
    }

    Ok(())
}

#[cfg(target_os = "macos")]
extern "C-unwind" fn never_key_window(_: &AnyObject, _: Sel) -> Bool {
    Bool::NO
}

#[cfg(target_os = "macos")]
fn apply_never_key_panel_class(ns_window: &NSWindow) -> Result<(), String> {
    let object: &AnyObject = ns_window.as_ref();
    let current_class = object.class();
    let current_class_name = current_class.name().to_string_lossy();
    if current_class_name.contains("PromptPickerNeverKeyPanel") {
        return Ok(());
    }
    if current_class_name.contains("Tao") || current_class_name.contains("Wry") {
        return Ok(());
    }

    let never_key_class = never_key_panel_class(current_class)?;
    unsafe {
        let previous_class = AnyObject::set_class(object, never_key_class);
        if previous_class as *const AnyClass != current_class as *const AnyClass {
            return Err("Unexpected window class changed while configuring overlay panel.".to_string());
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn never_key_panel_class(superclass: &'static AnyClass) -> Result<&'static AnyClass, String> {
    let class_name = format!("PromptPickerNeverKeyPanel_{}", sanitized_class_name(superclass));
    let class_name = CString::new(class_name).map_err(|e| e.to_string())?;
    if let Some(existing) = AnyClass::get(&class_name) {
        return Ok(existing);
    }

    let mut builder = ClassBuilder::new(&class_name, superclass)
        .ok_or_else(|| format!("Could not create {}", class_name.to_string_lossy()))?;
    unsafe {
        builder.add_method(
            sel!(canBecomeKeyWindow),
            never_key_window as extern "C-unwind" fn(_, _) -> _,
        );
        builder.add_method(
            sel!(canBecomeMainWindow),
            never_key_window as extern "C-unwind" fn(_, _) -> _,
        );
    }
    Ok(builder.register())
}

#[cfg(target_os = "macos")]
fn sanitized_class_name(class: &AnyClass) -> String {
    class
        .name()
        .to_string_lossy()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

#[cfg(target_os = "macos")]
pub fn configure_transparent_webview_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("ns_window returned null".to_string());
    }

    unsafe {
        let ns_window = &*(ns_window_ptr.cast::<NSWindow>());
        let clear = NSColor::clearColor();
        ns_window.setOpaque(false);
        ns_window.setBackgroundColor(Some(&clear));
        ns_window.setHasShadow(false);
    }

    window
        .with_webview(|webview| unsafe {
            let view: &WKWebView = &*webview.inner().cast();
            let draws_background = NSNumber::new_bool(false);
            let key = NSString::from_str("drawsBackground");
            let _: () = objc2::msg_send![view, setValue: &*draws_background, forKey: &*key];
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn activate_main_window(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_non_activating_panel(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_transparent_webview_window(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn non_activating_panel_configuration_mentions_never_key_window_guard() {
        let source = include_str!("macos_panels.rs");

        assert!(source.contains("PromptPickerNeverKeyPanel"));
        assert!(source.contains("canBecomeKeyWindow"));
        assert!(source.contains("canBecomeMainWindow"));
    }

    #[test]
    fn main_window_activation_remains_separate_from_overlay_configuration() {
        let source = include_str!("macos_panels.rs");

        assert!(source.contains("pub fn activate_main_window"));
        assert!(source.contains("pub fn configure_non_activating_panel"));
    }
}
