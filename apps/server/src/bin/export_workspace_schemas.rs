//! Regenerate the published workspace JSON Schemas from the Rust file types.

use std::path::PathBuf;
use std::process::ExitCode;

fn export() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = std::env::args()
        .nth(1)
        .map_or_else(|| PathBuf::from("schemas/v1"), PathBuf::from);
    std::fs::create_dir_all(&dir)?;
    for (name, schema) in aegis_server::workspace::schemas::documents() {
        let text = serde_json::to_string_pretty(&schema)? + "\n";
        std::fs::write(dir.join(format!("{name}.schema.json")), text)?;
    }
    Ok(dir)
}

fn main() -> ExitCode {
    match export() {
        Ok(dir) => {
            println!("wrote workspace schemas to {}", dir.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("export-workspace-schemas: {error}");
            ExitCode::FAILURE
        }
    }
}
