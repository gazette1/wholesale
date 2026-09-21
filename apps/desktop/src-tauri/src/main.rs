#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Read at compile time so an installer is pinned to the environment it was built for.
const DEFAULT_APP_URL: &str = "https://wholesale-demo-six.vercel.app";

fn app_url() -> String {
    match option_env!("DEALCALC_APP_URL") {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => DEFAULT_APP_URL.to_string(),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let url = app_url();
            let parsed = url.parse().map_err(|_| format!("DEALCALC_APP_URL is not a valid URL: {url}"))?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("DealCalc")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .center()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the DealCalc desktop app");
}
