# cf-cardano-staking-api

This is the staking API of a custodial CNFT staking system that allows checking for wallet rewards and starting a reward claim session. This API may be wallet by a website that allows the user to check the reward balance and initiate a clim session. The number of tokens a wallet can claim is calculated based on the elapsed time since the last claim and the defined daily reward rate for the asset. The system uses the [Blockfrost](https://blockfrost.io) API to query the wallet balance and ADA handle. The created claim sessions may be processed by the [Cardano Worker](https://github.com/SteffenKeller/cf-cardano-worker) server. A connection to a shared MongoDB instance is required. 

## Environment variables

- `DATABASE_URL` - MongoDB Connection String
- `BLOCKFROST_API_KEY` - Blockfrost API key

## Models

- `StakeAsset` represents a CNFT with a defined daily reward rate that is eligible for staking.
- `StakeClaim` represents a initiates claim session by the wallet holder
- `StakeReward` represents the token that can be claimed as staking reward

## Endpoints
- `GET /status` Check the server status
- `POST /rewards` Returns the available rewards for a given wallet address
- `POST /claim` Creates a new claim session with the requested assets 
- `GET /claim` Returns information about a claim session with a given sessionId

## Running the system

Run the server with `node app.js`