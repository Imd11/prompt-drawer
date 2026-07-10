use std::path::{Path, PathBuf};
use tauri::{WebviewUrl, WebviewWindowBuilder};

const OUTPUT_ENV: &str = "PROMPT_PICKER_CALICO_PROBE_OUTPUT";

pub fn enabled() -> bool {
    std::env::var_os(OUTPUT_ENV).is_some()
}

fn output_path() -> Result<PathBuf, String> {
    std::env::var_os(OUTPUT_ENV)
        .map(PathBuf::from)
        .ok_or_else(|| format!("{OUTPUT_ENV} is not set"))
}

fn write_json_atomically(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Probe output path has no parent directory.".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn record_calico_surface_probe(
    report: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = output_path()?;
    write_json_atomically(&path, &report)?;
    app.exit(0);
    Ok(())
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), String> {
    let output = output_path()?;
    if output.exists() {
        std::fs::remove_file(&output).map_err(|error| error.to_string())?;
    }

    WebviewWindowBuilder::new(
        app,
        "calico-runtime-surface-probe",
        WebviewUrl::App("calico/runtime-surface-probe.html".into()),
    )
    .title("Calico Runtime Surface Probe")
    .inner_size(320.0, 180.0)
    .visible(true)
    .build()
    .map_err(|error| error.to_string())?;

    let timeout_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(30));
        if output.exists() {
            return;
        }
        let timeout_report = serde_json::json!({
            "error": "native probe timeout",
            "rendererDiagnostics": null
        });
        let _ = write_json_atomically(&output, &timeout_report);
        eprintln!("Calico probe timed out before the WebView reported a result.");
        timeout_app.exit(3);
    });

    Ok(())
}
