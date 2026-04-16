# Pier on Kubernetes

Single-service deploy, no Helm dependency. Works on any cluster (k3s, rke2, kind, EKS, GKE, AKS).

## One-liner install (dev / homelab)

```bash
kubectl apply -f https://raw.githubusercontent.com/spranab/mcpier/main/deploy/kubernetes/install.yaml
kubectl -n pier port-forward svc/pier 8420:8420
# → open http://localhost:8420 and sign in with the placeholder token:
#   pier-dev-token-rotate-me-before-storing-real-secrets
```

That's the full deploy: namespace, pvc, configmap, secret, deployment, service — all in [`install.yaml`](./install.yaml).

**Before you store real API keys, rotate the default secret.** Pier encrypts at rest with `PIER_MASTER_KEY`; any secret stored under the placeholder key becomes unreadable after rotation, so rotate while the box is empty:

```bash
kubectl -n pier delete secret pier-secrets

kubectl -n pier create secret generic pier-secrets \
  --from-literal=PIER_MASTER_KEY="$(openssl rand -hex 32)" \
  --from-literal=PIER_TOKENS="$(openssl rand -hex 24)"

kubectl -n pier rollout restart deployment/pier
```

## Secure install (production — no placeholder secret ever reaches the cluster)

### 1. Create the secret out-of-band

```bash
kubectl create namespace pier

kubectl -n pier create secret generic pier-secrets \
  --from-literal=PIER_MASTER_KEY="$(openssl rand -hex 32)" \
  --from-literal=PIER_TOKENS="$(openssl rand -hex 24)"
```

Each comma-separated value in `PIER_TOKENS` is one device bearer token. Generate one per machine you'll sync from:

```bash
kubectl -n pier create secret generic pier-secrets \
  --from-literal=PIER_MASTER_KEY="$(openssl rand -hex 32)" \
  --from-literal=PIER_TOKENS="$(openssl rand -hex 24),$(openssl rand -hex 24)"
```

### 2. Apply everything else

```bash
kubectl apply -k deploy/kubernetes/
```

Uses kustomize; skips the placeholder `secret.yaml` since you created one in step 1. Equivalent: `kubectl apply -f deploy/kubernetes/{namespace,configmap,pvc,deployment,service}.yaml`.

## 3. Verify

```bash
kubectl -n pier get pods
kubectl -n pier logs -l app.kubernetes.io/name=pier -f
kubectl -n pier port-forward svc/pier 8420:8420
curl http://localhost:8420/health
```

Open `http://localhost:8420` in a browser and sign in with one of your `PIER_TOKENS`.

## 4. (Optional) Expose via Ingress

Edit [`ingress.yaml`](./ingress.yaml) — uncomment and adjust hostname/TLS/annotations for your controller. Important annotations for SSE (stdio-spawn bridge relies on long-lived connections):

- nginx: `nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"` + `proxy-buffering: "off"`
- traefik: `traefik.ingress.kubernetes.io/buffering: off`

Then uncomment the `ingress.yaml` line in `kustomization.yaml` and `kubectl apply -k .` again.

## Image tags

CI publishes on every push to `main`:

| Tag | What it is |
|---|---|
| `ghcr.io/spranab/mcpier:latest` | latest green build from main |
| `ghcr.io/spranab/mcpier:sha-abc1234` | specific commit (pin this in production) |

Change the tag in [`deployment.yaml`](./deployment.yaml) to pin.

## Storage

Default PVC requests 1 Gi. Pier's DB (secrets + subscriptions + audit) is tiny; 1 Gi leaves massive headroom. Edit [`pvc.yaml`](./pvc.yaml) to set `storageClassName` if your cluster doesn't have a default.

## Resources

Defaults sized for a homelab single-user deploy:

- Requests: 100m CPU / 128Mi memory
- Limits: 1 CPU / 1 Gi memory

Adjust `resources:` in [`deployment.yaml`](./deployment.yaml) if you install many heavy MCPs with `location: remote` (each spawned subprocess shares this limit).

## Backups

For a single-replica deploy, the cheapest backup is a `CronJob` that `tar`s `/data` into object storage. Template:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: pier-backup
  namespace: pier
spec:
  schedule: "0 3 * * *"   # 03:00 daily
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: tar
              image: alpine:3.20
              command: ["sh", "-c", "tar czf - /data | some-upload-cmd"]
              volumeMounts:
                - { name: data, mountPath: /data, readOnly: true }
          volumes:
            - name: data
              persistentVolumeClaim:
                claimName: pier-data
```
