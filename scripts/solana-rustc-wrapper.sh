#!/usr/bin/env bash
exec "$HOME/.rustup/toolchains/solana/bin/rustc" -Z unstable-options "$@"
