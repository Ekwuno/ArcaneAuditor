#!/usr/bin/env bash
# Installs the Arcane Auditor CLI binary from a GitHub release.
#
# Used by the GitHub Action (action.yml) and usable on its own for local
# installs:
#
#   ARCANE_VERSION=2.0.0 ARCANE_INSTALL_DIR=~/.arcane-auditor/bin bash install.sh
#
# Environment:
#   ARCANE_VERSION      Release tag without the leading "v" (default: 2.0.0)
#   ARCANE_INSTALL_DIR  Where the binary ends up (default: ~/.arcane-auditor/bin)
#   ARCANE_REPO         GitHub repo that publishes releases
#                       (default: Developers-and-Dragons/ArcaneAuditor)
#   ARCANE_SHA256       Override the expected hash for the downloaded asset.
#                       Required when ARCANE_VERSION is not in the pinned table
#                       below, unless ARCANE_ALLOW_UNPINNED=1 is set.
#   ARCANE_ALLOW_UNPINNED  Set to 1 to fall back to the release's .sha256
#                       sidecar for versions without a pinned hash. That only
#                       detects a corrupted download, not a republished asset.
#
# Every downloaded asset is verified against a hash pinned in this file, so a
# release that was re-uploaded or tampered with fails the install.
set -euo pipefail

ARCANE_VERSION="${ARCANE_VERSION:-2.0.0}"
ARCANE_INSTALL_DIR="${ARCANE_INSTALL_DIR:-$HOME/.arcane-auditor/bin}"
ARCANE_REPO="${ARCANE_REPO:-Developers-and-Dragons/ArcaneAuditor}"

# Pinned asset hashes, one line per version and platform. Add a line here
# when bumping the default version.
pinned_sha256() {
  case "$1" in
    2.0.0-linux) echo "2ff157717b4e37e30a1ea67db9d4bdd49edf16f301253f6687412324301848bf" ;;
    2.0.0-macos) echo "e6603eed1a0fa2548a5994239d492be4ab51905c72d40c465e8d3e15605d74f6" ;;
    *) echo "" ;;
  esac
}

case "$(uname -s)" in
  Linux)  platform=linux; asset="ArcaneAuditor_linux_CLI.tar.gz" ;;
  Darwin) platform=macos; asset="ArcaneAuditor_macOS_CLI.zip" ;;
  *) echo "install.sh: unsupported platform $(uname -s). Use the Windows .exe from the release page." >&2; exit 1 ;;
esac

binary="$ARCANE_INSTALL_DIR/ArcaneAuditorCLI"

# Skip the download when the requested version is already installed.
if [ -x "$binary" ] && "$binary" --version 2>/dev/null | grep -q "v${ARCANE_VERSION}\b"; then
  echo "Arcane Auditor v${ARCANE_VERSION} already installed at $binary"
else
  url="https://github.com/${ARCANE_REPO}/releases/download/v${ARCANE_VERSION}/${asset}"
  expected="${ARCANE_SHA256:-$(pinned_sha256 "${ARCANE_VERSION}-${platform}")}"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "Downloading ${url}"
  curl -fsSL --retry 3 -o "$tmp/$asset" "$url"

  if [ -z "$expected" ]; then
    if [ "${ARCANE_ALLOW_UNPINNED:-0}" != "1" ]; then
      echo "install.sh: no pinned sha256 for v${ARCANE_VERSION} on ${platform}." >&2
      echo "Set ARCANE_SHA256=<hash> or ARCANE_ALLOW_UNPINNED=1 to trust the release sidecar." >&2
      exit 1
    fi
    echo "Warning: no pinned hash for v${ARCANE_VERSION}; trusting the release .sha256 sidecar" >&2
    expected="$(curl -fsSL "${url}.sha256" | awk '{print $1}')"
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "install.sh: sha256 mismatch for $asset" >&2
    echo "  expected $expected" >&2
    echo "  actual   $actual" >&2
    exit 1
  fi
  echo "Verified sha256 ${actual}"

  rm -rf "$ARCANE_INSTALL_DIR"
  mkdir -p "$ARCANE_INSTALL_DIR"
  case "$platform" in
    linux)
      # The Linux release is a single self-contained binary.
      tar -xzf "$tmp/$asset" -C "$ARCANE_INSTALL_DIR"
      ;;
    macos)
      # The macOS release is a folder (binary plus _internal/). Keep the folder
      # intact and expose the binary through a symlink.
      unzip -q "$tmp/$asset" -d "$ARCANE_INSTALL_DIR/macos"
      ln -s "macos/ArcaneAuditorCLI/ArcaneAuditorCLI" "$binary"
      ;;
  esac
  chmod +x "$ARCANE_INSTALL_DIR/macos/ArcaneAuditorCLI/ArcaneAuditorCLI" 2>/dev/null || chmod +x "$binary"
  echo "Installed Arcane Auditor to $binary"
fi

"$binary" --version

# Make the binary available to later steps in a GitHub Actions job.
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$ARCANE_INSTALL_DIR" >> "$GITHUB_PATH"
fi
