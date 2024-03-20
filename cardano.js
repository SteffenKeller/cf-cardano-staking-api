const logging = require('./logging')
const fetch = require('node-fetch')
const cardanoSerialization = require("@emurgo/cardano-serialization-lib-nodejs");

/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryLatestEpoch() {
    const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/epochs/latest', {
        headers : {
            project_id: process.env.BLOCKFROST_API_KEY
        }
    });
    if (response.status !== 200) {
        response.json().then(console.log).catch(console.log)
        logging.error(response)
        return null
    }
    const json = await response.json()
    return json
}
exports.queryLatestEpoch = queryLatestEpoch

/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryAssetsForStakeAddress(stakeAddress) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    while (fetchNextPage) {
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/accounts/'+stakeAddress+'/addresses/assets?page='+page, {
            headers : {
                project_id: process.env.BLOCKFROST_API_KEY
            }
        });
        if (response.status === 404) {
            logging.info('[Blockfrost] Wallet '+stakeAddress+' does not exist')
            return null
        }
        if (response.status !== 200) {
            logging.error(`[Blockfrost] Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null) {
            logging.error('[Blockfrost] Response could not be parsed')
            console.log('Response', response)
            console.log('Json', json)
            return null
        }
        if (json.length === 0) {
            fetchNextPage = false
            break
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    return fullResponse
}
exports.queryAssetsForStakeAddress = queryAssetsForStakeAddress

/**
 * Obtain account info for a given stake address.
 */
async function queryAccountInfo(stakeAddress) {
    const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/accounts/'+stakeAddress, {
        headers : {
            project_id: process.env.BLOCKFROST_API_KEY
        }
    });
    if (response.status === 404) {
        logging.info('Account '+stakeAddress+' does not exist')
        return null
    }
    if (response.status !== 200) {
        response.json().then(console.log).catch(console.log)
        logging.error(response)
        return null
    }
    const json = await response.json()
    if (json == null || json.length === 0) {
        return null
    }
    return json
}
exports.queryAccountInfo = queryAccountInfo

/**
 * Query the address of an ADA Handle.
 */
async function queryHandleAddress(handleName) {

    const policyID = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';
    if (handleName.length === 0) {
        return null
    }

    // Convert handleName to hex encoding.
    const assetName = Buffer.from(handleName).toString('hex');

    // Fetch matching address for the asset.
    const data = await fetch(
        `https://cardano-mainnet.blockfrost.io/api/v0/assets/${policyID}${assetName}/addresses`,
        {
            headers: {
                project_id: process.env.BLOCKFROST_API_KEY,
                'Content-Type': 'application/json'
            }
        }
    ).then(res => res.json());

    if (data?.error) {
        logging.error(data?.error)
        return null
    }
    const [{ address }] = data;
    return address
}
exports.queryHandleAddress = queryHandleAddress

/**
 * Obtain information about assets associated with addresses of a specific account. Be careful, as an account could be part of a mangled address and does not necessarily mean the addresses are owned by user as the account.
 */
async function queryPoolStakeDistribution(epoch, poolId) {
    let fullResponse = []
    let fetchNextPage = true
    let page = 1
    while (fetchNextPage) {
        const response = await fetch('https://cardano-mainnet.blockfrost.io/api/v0/epochs/'+epoch+'/stakes/'+poolId+'?page='+page, {
            headers : {
                project_id: process.env.BLOCKFROST_API_KEY
            }
        });
        if (response.status === 404) {
            logging.info('[Blockfrost] Stake pool '+poolId+' or epoch '+epoch+' does not exist')
            return null
        }
        if (response.status !== 200) {
            logging.error(`[Blockfrost] Status: ${response.status} ${response.statusText}, URL: ${response.url}`)
            return null
        }
        const json = await response.json()
        if (json == null) {
            logging.error('[Blockfrost] Response could not be parsed')
            console.log('Response', response)
            console.log('Json', json)
            return null
        }
        if (json.length === 0) {
            fetchNextPage = false
            break
        }
        page += 1
        fullResponse = fullResponse.concat(json)
    }
    return fullResponse
}
exports.queryPoolStakeDistribution = queryPoolStakeDistribution


/**
 * Returns the stake key for a given payment address.
 */
function calculateStakeAddress(address) {
    let addr = cardanoSerialization.Address.from_bech32(address)
    let base_addr = cardanoSerialization.BaseAddress.from_address(addr)
    if (base_addr == null) {
        return null
    }
    let stake_cred = base_addr.stake_cred()
    let reward_addr_bytes = new Uint8Array(29)
    reward_addr_bytes.set([0xe1], 0)
    reward_addr_bytes.set(stake_cred.to_bytes().slice(4, 32), 1)
    let reward_addr = cardanoSerialization.RewardAddress.from_address(cardanoSerialization.Address.from_bytes(reward_addr_bytes))
    return reward_addr.to_address().to_bech32()
}
exports.calculateStakeAddress = calculateStakeAddress
