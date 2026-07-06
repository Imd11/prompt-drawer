use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_PROMPT_LIBRARY_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone, Debug, serde::Serialize)]
pub struct PromptLibraryFile {
    content: String,
    signature: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct PromptLibraryFileMetadata {
    signature: String,
}

pub fn validate_prompt_library_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("json") => Ok(()),
        _ => Err("Please choose a JSON prompt library file.".to_string()),
    }
}

fn validate_prompt_library_file(path: &str) -> Result<(), String> {
    validate_prompt_library_path(path)?;
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Please choose a JSON prompt library file.".to_string());
    }
    if metadata.len() > MAX_PROMPT_LIBRARY_BYTES {
        return Err("Prompt library file is too large.".to_string());
    }
    Ok(())
}

fn file_signature(path: &str) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(format!("{}:{}", metadata.len(), modified_ms))
}

fn temp_path_for(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Please choose a JSON prompt library file.".to_string())?;
    Ok(path.with_file_name(format!("{}.tmp", file_name)))
}

#[tauri::command]
pub fn read_prompt_library_file(path: String) -> Result<PromptLibraryFile, String> {
    validate_prompt_library_file(&path)?;
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    Ok(PromptLibraryFile {
        content,
        signature: file_signature(&path)?,
    })
}

#[tauri::command]
pub fn write_prompt_library_file(
    path: String,
    content: String,
) -> Result<PromptLibraryFileMetadata, String> {
    validate_prompt_library_path(&path)?;
    if content.as_bytes().len() as u64 > MAX_PROMPT_LIBRARY_BYTES {
        return Err("Prompt library file is too large.".to_string());
    }
    let tmp_path = temp_path_for(&path)?;
    fs::write(&tmp_path, content).map_err(|error| error.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        error.to_string()
    })?;
    Ok(PromptLibraryFileMetadata {
        signature: file_signature(&path)?,
    })
}

#[tauri::command]
pub fn prompt_library_file_metadata(path: String) -> Result<PromptLibraryFileMetadata, String> {
    validate_prompt_library_file(&path)?;
    Ok(PromptLibraryFileMetadata {
        signature: file_signature(&path)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_json_prompt_library_path() {
        let error = validate_prompt_library_path("/tmp/prompts.txt").unwrap_err();
        assert!(error.contains("JSON"));
    }

    #[test]
    fn allows_json_prompt_library_path() {
        assert!(validate_prompt_library_path("/tmp/prompts.json").is_ok());
    }
}
