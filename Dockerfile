# THE WINDOW — backend image (indexer + control) for Render.
# Bakes the gitignored runtime artifacts a fresh clone would be missing:
# contract ABIs (contracts/out), the Fuji deployment addresses (deployments/43113.json),
# the PoCD + collateral-solvency zkeys/wasm (circuits/build/*), and the EERC circom
# artifacts (registration/withdraw/transfer). One image runs both HTTP services; Render
# overrides the start command per service (see the deploy step).
FROM node:20-bookworm-slim

# native toolchain for eerc-node crypto deps (ffjavascript / circomlibjs / maci-crypto)
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) install prod deps for BOTH packages (cached until a lockfile changes)
COPY services/package.json services/package-lock.json ./services/
RUN cd services && npm ci --omit=dev
COPY packages/eerc-node/package.json packages/eerc-node/package-lock.json ./packages/eerc-node/
RUN cd packages/eerc-node && npm ci --omit=dev

# 2) service + crypto source (node_modules excluded via .dockerignore)
COPY services ./services
COPY packages/eerc-node/src ./packages/eerc-node/src

# 3) contract ABIs + the deployed Fuji addresses
COPY contracts/out ./contracts/out
COPY contracts/deployments/43113.json ./contracts/deployments/43113.json

# 4) ZK proving artifacts used by control/admin (M-ONIA PoCD + collateral solvency)
COPY circuits/build/depth_array_final.zkey ./circuits/build/depth_array_final.zkey
COPY circuits/build/depth_pocd_array_js/depth_pocd_array.wasm ./circuits/build/depth_pocd_array_js/depth_pocd_array.wasm
COPY circuits/build/solvency_final.zkey ./circuits/build/solvency_final.zkey
COPY circuits/build/collateral_solvency_js/collateral_solvency.wasm ./circuits/build/collateral_solvency_js/collateral_solvency.wasm

# 5) EERC submodule circom artifacts (registration / withdraw / transfer)
COPY contracts/lib/EncryptedERC/circom/build/registration ./contracts/lib/EncryptedERC/circom/build/registration
COPY contracts/lib/EncryptedERC/circom/build/withdraw ./contracts/lib/EncryptedERC/circom/build/withdraw
COPY contracts/lib/EncryptedERC/circom/build/transfer ./contracts/lib/EncryptedERC/circom/build/transfer

ENV NODE_ENV=production
# Default = indexer. Render overrides per service:
#   indexer:  sh -c 'INDEXER_PORT=$PORT node services/indexer/index.mjs'
#   control:  sh -c 'CONTROL_PORT=$PORT node services/control/index.mjs'
CMD ["node", "services/indexer/index.mjs"]
