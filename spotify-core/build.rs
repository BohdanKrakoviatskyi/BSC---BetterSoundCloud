fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    #[cfg(feature = "swift")]
    generate_swift_bridge();
}

/// writes the swift glue the xcode project compiles. only the apple apps need
/// it, so a linux build with the c abi alone leaves that directory alone.
#[cfg(feature = "swift")]
fn generate_swift_bridge() {
    use std::path::PathBuf;

    let bridge_files = ["src/swift_ffi.rs"];

    for bridge_file in bridge_files {
        println!("cargo:rerun-if-changed={bridge_file}");
    }

    let generated_directory = PathBuf::from("../Resonance/Resonance/Bridge/Generated");
    std::fs::create_dir_all(&generated_directory)
        .expect("failed to create the swift-bridge output directory");

    swift_bridge_build::parse_bridges(bridge_files)
        .write_all_concatenated(generated_directory, env!("CARGO_PKG_NAME"));
}
