mod error;
mod export;
mod history;
mod intelligence;
mod jobs;
mod links;
mod media;
mod paths;
mod projects;
mod settings;
mod sidecar;
mod transcribe;
mod transcript;
mod whisper;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(jobs::JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            jobs::cancel_job,
            history::load_ask_history,
            history::save_ask_entry,
            history::delete_ask_entry,
            history::clear_ask_history,
            sidecar::sidecar_status,
            settings::load_settings,
            settings::save_settings,
            settings::default_export_dir,
            settings::api_key_status,
            settings::set_api_key,
            settings::delete_api_key,
            settings::verify_api_key,
            links::probe_link,
            links::fetch_link,
            media::import_media,
            media::probe_media,
            media::generate_peaks,
            media::load_peaks,
            media::create_preview_proxy,
            projects::save_project,
            projects::load_project,
            projects::list_projects,
            projects::delete_project,
            projects::relink_source,
            whisper::list_whisper_models,
            whisper::download_whisper_model,
            whisper::delete_whisper_model,
            transcribe::transcribe,
            intelligence::analyze_text,
            export::export_clip,
            export::write_text_file,
            export::path_exists,
            export::open_path,
            export::open_url,
            export::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
