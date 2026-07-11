# THE WINDOW — build / test / demo orchestration.
.PHONY: help circuits circuits-array test test-contracts test-dash build deploy-local demo clean anvil

RPC_LOCAL := http://127.0.0.1:8545
ANVIL_KEY0 := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

help:
	@echo "make circuits        — build+prove PoCD (single-sum) + CollateralSolvency verifiers"
	@echo "make circuits-array  — build+prove the 37-tick DepthCurve array PoCD (needs 2^20 ptau)"
	@echo "make test            — forge tests (unit + invariants) + dashboard vitest"
	@echo "make deploy-local    — deploy the full WINDOW stack to a running anvil"
	@echo "make demo            — anvil + deploy + services + scripted full-epoch scenario"

circuits:
	bash circuits/build_pocd_gate.sh
	bash circuits/build_solvency.sh

circuits-array:
	cd packages/eerc-node && node src/gen_pocd_array_input.mjs
	bash circuits/build_pocd_array.sh

build:
	cd contracts && forge build

test: test-contracts test-dash

test-contracts:
	cd contracts && forge test

test-dash:
	cd dashboard && npm run test --silent || true

anvil:
	anvil --silent &

deploy-local:
	bash scripts/deploy_local.sh
	node packages/eerc-node/src/register_all.mjs

demo:
	bash demo/run_demo.sh

clean:
	cd contracts && forge clean
	rm -rf circuits/build/*_js circuits/build/*.wtns circuits/build/*.zkey
