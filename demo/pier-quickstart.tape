# VHS tape: the Pier quickstart, rendered as a GIF for the README.
# Regenerate with:
#   docker network create pier-demo-net 2>/dev/null
#   docker run -d --name pier --network pier-demo-net -p 8430:8420 \
#     -e PIER_MASTER_KEY=$(openssl rand -hex 32) \
#     -e PIER_TOKENS=demo-device-token \
#     ghcr.io/spranab/mcpier:latest
#   docker build -t vhs-pier -f - . <<'DOCKERFILE'
#   FROM ghcr.io/charmbracelet/vhs:latest
#   RUN apt-get update && apt-get install -y --no-install-recommends curl \
#    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
#    && apt-get install -y --no-install-recommends nodejs \
#    && npm i -g mcpier && rm -rf /var/lib/apt/lists/*
#   DOCKERFILE
#   docker run --rm --network pier-demo-net -v $(pwd):/vhs -w /vhs vhs-pier demo/pier-quickstart.tape
#
# Inside the container, `pier` is the hostname of the Pier container.

Output demo/pier-quickstart.gif
Set Shell "bash"
Set FontSize 14
Set Width 1100
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set PlaybackSpeed 1.0

Hide
Type "clear" Enter
Show

Sleep 600ms

Type "# mcpier — install MCPs on your homelab, sync to every client"
Sleep 1s
Enter
Sleep 600ms

Type "pier login http://pier:8420 --token demo-device-token"
Sleep 400ms
Enter
Sleep 1200ms

Type "pier install brainstorm-mcp --location remote --non-interactive --set openai_key=sk-demo-key"
Sleep 400ms
Enter
Sleep 2s

Type "pier install saga-mcp --location local --non-interactive --set saga_db_path=/data/saga.db"
Sleep 400ms
Enter
Sleep 2s

Type "pier status"
Sleep 400ms
Enter
Sleep 3500ms

Type "# secrets live encrypted on pier. clients never see them."
Sleep 2s
