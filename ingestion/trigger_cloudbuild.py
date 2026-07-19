"""
Soumet un build Cloud Build directement via API GCP (bypass GitHub Actions).
Usage : python ingestion/trigger_cloudbuild.py
"""

import io, os, tarfile, time, subprocess, requests
import google.auth
import google.auth.transport.requests
from google.cloud import storage

PROJECT   = "homepedia-493013"
REGION    = "europe-west1"
BUCKET    = f"{PROJECT}_cloudbuild"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

IGNORE = {
    ".git", "node_modules", "__pycache__", ".venv", "dist", "build",
    "dbt_packages", "target", ".mypy_cache", "homepedia_dbt/target",
    "homepedia_dbt/dbt_packages", "ingestion/.venv",
}

def should_ignore(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    return any(p in IGNORE for p in parts)

def make_tarball() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for root, dirs, files in os.walk(REPO_ROOT):
            dirs[:] = [d for d in dirs if not should_ignore(
                os.path.relpath(os.path.join(root, d), REPO_ROOT)
            )]
            for f in files:
                fpath = os.path.join(root, f)
                arcname = os.path.relpath(fpath, REPO_ROOT)
                if not should_ignore(arcname):
                    tar.add(fpath, arcname=arcname)
    return buf.getvalue()

def get_token() -> str:
    creds, _ = google.auth.default()
    req = google.auth.transport.requests.Request()
    creds.refresh(req)
    return creds.token

def get_commit_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, text=True
        ).strip()
    except Exception:
        return "manual"

def main():
    commit = get_commit_sha()
    print(f"🚀 Soumission Cloud Build — commit {commit}")
    print(f"   Projet : {PROJECT} | Région : {REGION}\n")

    # 1. Créer l'archive source
    print("  📦 Création archive source…")
    tarball = make_tarball()
    size_mb = len(tarball) / 1024 / 1024
    print(f"     Archive : {size_mb:.1f} MB")

    # 2. Uploader dans GCS
    object_name = f"source/{commit}-{int(time.time())}.tar.gz"
    print(f"  ☁️  Upload GCS : gs://{BUCKET}/{object_name}…")
    gcs = storage.Client(project=PROJECT)
    try:
        bucket = gcs.bucket(BUCKET)
        blob = bucket.blob(object_name)
        blob.upload_from_string(tarball, content_type="application/gzip")
        print(f"     ✅ Upload OK")
    except Exception as e:
        print(f"     ❌ Erreur upload: {e}")
        return

    # 3. Appel API Cloud Build
    print(f"  🔨 Déclenchement Cloud Build…")
    token = get_token()

    # Lire le cloudbuild.yaml et l'injecter directement dans le payload
    import yaml
    with open(os.path.join(REPO_ROOT, "cloudbuild.yaml")) as f:
        cb = yaml.safe_load(f)

    url = f"https://cloudbuild.googleapis.com/v1/projects/{PROJECT}/builds"
    payload = {
        "source": {
            "storageSource": {
                "bucket": BUCKET,
                "object": object_name,
            }
        },
        "steps":              cb.get("steps", []),
        "images":             cb.get("images", []),
        "availableSecrets":   cb.get("availableSecrets", {}),
        "options":            cb.get("options", {}),
        "substitutions": {
            **cb.get("substitutions", {}),
            "COMMIT_SHA": commit,
        },
    }
    resp = requests.post(
        url,
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )

    if resp.status_code in (200, 201):
        data = resp.json()
        build_id = data.get("metadata", {}).get("build", {}).get("id", "?")
        build_url = f"https://console.cloud.google.com/cloud-build/builds/{build_id}?project={PROJECT}"
        print(f"\n  ✅ Build lancé !")
        print(f"  Build ID : {build_id}")
        print(f"  Suivi    : {build_url}")
        print(f"\n  ⏳ Build Cloud Run ~8-12 min (backend + frontend)")
    else:
        print(f"\n  ❌ Erreur API Cloud Build : {resp.status_code}")
        print(f"  {resp.text[:500]}")

if __name__ == "__main__":
    main()
