# Hardhat Project for PowerLoom On-chain Contracts 

## Installation

1. Node >=v18.x. Run `nvm use` from this folder.

2. `npm install`

3. Copy `.env.example` to `.env` and fill the required fields (default values will work for tests):
    - PRIVATE_KEY: Private key for the owner account to be used
    - RPC_URL_CONDUIT: RPC URL for the target deployment chain

## Running

Try running some of the following tasks:

```shell
npx hardhat test
npx hardhat coverage
npx hardhat compile
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js
```

To run using a specific network configured in `hardhat.config.js`:
```shell
npx hardhat run scripts/deploy.js --network conduit
```
