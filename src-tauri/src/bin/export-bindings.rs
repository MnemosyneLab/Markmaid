use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};

use markmaid_lib::ipc::command_builder;
use specta_typescript::{BigIntExportBehavior, Typescript};

fn main() -> Result<(), Box<dyn Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let check_only = arguments.as_slice() == ["--check"];
    if !arguments.is_empty() && !check_only {
        return Err("usage: export-bindings [--check]".into());
    }

    let output_path = bindings_path();
    if check_only {
        let temporary_path =
            env::temp_dir().join(format!("markmaid-tauri-bindings-{}.ts", std::process::id()));
        command_builder().export(typescript_exporter(), &temporary_path)?;
        let generated = fs::read(&temporary_path)?;
        let committed = fs::read(&output_path).map_err(|error| {
            format!(
                "could not read committed bindings at {}: {error}",
                output_path.display()
            )
        })?;
        let _ = fs::remove_file(&temporary_path);
        if generated != committed {
            return Err(format!(
                "generated bindings are stale; run pnpm ipc:generate ({})",
                output_path.display()
            )
            .into());
        }
        println!("IPC bindings are up to date.");
        return Ok(());
    }

    command_builder().export(typescript_exporter(), &output_path)?;
    println!("Generated {}", output_path.display());
    Ok(())
}

fn bindings_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("generated")
        .join("tauri-bindings.ts")
}

fn typescript_exporter() -> Typescript {
    Typescript::default()
        .header("// @ts-nocheck\n")
        .bigint(BigIntExportBehavior::Number)
}
