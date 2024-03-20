const logging = require('./logging')
const cardano = require('./cardano')
const StakeAsset = require('./models/StakeAsset')
const StakeClaim = require('./models/StakeClaim')
const StakeReward = require('./models/StakeReward')
const faucetAddress = '' // Address of the staking wallet
const poolId = 'pool...' // Pool id of the stake pool that waives the claiming fee

/**
 * A list of all policy ids for which stake assets are checked
 */
const relevantStakeAssetPolicyIds = [
    "policy_id", // Policy of a CNFT collection
]

const calculateRewardForAssetId = async (assetId) => {
    if (assetId == null) {
        return {success: false, message: 'Not Found'}
    }
    // Fetch the stake asset
    let stakeAsset = await StakeAsset.findOne({assetId: assetId}).exec()
    if (stakeAsset == null) {
        stakeAsset = await StakeAsset.findOne({name: assetId}).exec()
        if (stakeAsset == null) {
            logging.info(`Could not find stake asset for asset id ${assetId}`)
            return {success: false, message: 'Not Found'}
        }

    }

    // Check if the stake asset is active
    if (stakeAsset.active === false) {
        return {success: false, message: 'Asset Not Active'}
    }

    // Calculate the rewards for this asset
    const now = new Date()
    const unclaimedDays = (now - stakeAsset.lastClaim) / 1000 / 60 / 60 / 24;
    let rewardAmount = Math.floor(unclaimedDays*stakeAsset.rewardAmountPerDay)
    if (rewardAmount > stakeAsset.maximumReward) {
        rewardAmount = stakeAsset.maximumReward
    }
    if (rewardAmount < 0) {
        return {success: false, message: 'Calculation Error'}
    }

    // Fetch the reward object
    const stakeReward = await StakeReward.findById(stakeAsset.reward).exec()
    if (stakeReward == null) {
        logging.info(`Could not find stake reward ${stakeAsset.reward}`)
        return {success: false, message: 'Reward Not Found'}
    }

    logging.info(`Successfully fetched rewards for asset ${assetId}`)
    return {
        success: true,
        assetId: stakeAsset.assetId,
        name: stakeAsset.name,
        rewardAmount: rewardAmount,
        rewardAssetId: stakeReward.assetId,
        rewardName: stakeReward.name,
        rewardDecimals: stakeReward.decimals
    }
}
exports.calculateRewardForAssetId = calculateRewardForAssetId

const calculateRewards = async (inputAddress, assetProjects) => {
    const numberFormatter = new Intl.NumberFormat('en', {maximumFractionDigits: 2})
    let isDelegator = true
    let claimedRewardsInEpoch = false
    let serviceFee = 0

    // Fetch handle
    if (inputAddress.startsWith('$')) {
        inputAddress = await cardano.queryHandleAddress(inputAddress.substring(1))
    }
    if (inputAddress == null) {
        return {success: false, message: 'Please enter a valid payment address or handle'}
    }

    logging.info(`Fetching rewards for wallet ${inputAddress}`)

    // Calculate stake address
    let stakeAddress
    try {
        stakeAddress = cardano.calculateStakeAddress(inputAddress)
    } catch(e) {
        logging.info(`Could not calculate stake address for \"${inputAddress}\". Error: ${e.toString()}`)
        return {success: false, message: 'Please enter a valid payment address or handle'}
    }

    if (stakeAddress == null) {
        logging.info(`Address ${inputAddress} does not contain a stake key`)
        return {success: false, message: 'Address does not contain a stake key'}
    }

    // Check if the wallet is staking with the pool
    const accountInfo = await cardano.queryAccountInfo(stakeAddress)
    if (accountInfo == null) {
        logging.error(`Could not query account info for ${inputAddress}`)
        return {success: false, message: 'Could not query account info'}
    }

    if (accountInfo['pool_id'] == null ) {
        logging.info(`Address ${inputAddress} is not delegated to a pool`)
        return {success: false, message: 'Your wallet must be delegated to any pool in order to claim rewards. When staking with our pool you can claim rewards without paying a service fee.'}
    }

    if (accountInfo['pool_id'] == null || accountInfo['pool_id'] !== poolId) {
        serviceFee = 2_000_000
        isDelegator = false
    }

    // Check if there is an open claim session
    const openClaim = await StakeClaim.findOne({stakeAddress: stakeAddress, status: 'OPEN'}).exec()
    if (openClaim != null) {

        // Release the reserved rewards tokens
        for (const [key, value] of Object.entries(openClaim.assets)) {
            const stakeReward = await StakeReward.findOne({assetId: key}).exec()
            if (stakeReward == null) {
                logging.error(`Tried to free tokens, but no rewards found for asset id ${key}`)
                return {success: false, message: 'Impossible... No stake reward found'}
            }

            // Free tokens
            stakeReward.reservedBalance = stakeReward.reservedBalance-value
            await stakeReward.save()
            logging.info(`Released ${value} reserved token of asset ${key}`)
        }

        // Invalidate the claim
        openClaim.status = 'INVALID'
        await openClaim.save()
        logging.info(`Claim ${openClaim.sessionId} invalidated`)
    }

    // Get current epoch
    const epochDetails = await cardano.queryLatestEpoch()
    if (epochDetails == null) {
        logging.error('Could not query latest epoch')
        return {success: false, message: 'Could not query latest epoch'}
    }

    // Check if wallet has already claimed in the current epoch
    const lastClaim = await StakeClaim.findOne({stakeAddress: stakeAddress, status: 'COMPLETED', epoch: epochDetails.epoch}).exec()
    if (lastClaim != null) {
        claimedRewardsInEpoch = true
        logging.info(`Wallet ${stakeAddress} already claimed rewards in the current epoch ${epochDetails.epoch}`)
    }

    // Fetch staking rewards
    let delegatorRewards = []
    if (isDelegator === true && claimedRewardsInEpoch === false && assetProjects == null) {
        // Find the active stake of the wallet
        const activeStakes = await cardano.queryPoolStakeDistribution(epochDetails.epoch, poolId)
        if (activeStakes == null) {
            return {success: false, message: 'Could not query active stake'}
        }
        const walletStake = activeStakes.find(e => e['stake_address'] === stakeAddress)
        if (walletStake != null) {
            // Fetch delegator reward
            const customStakePoolReward = await StakeReward.findById('<custom>').exec()
            if (customStakePoolReward != null && customStakePoolReward.active === true) {
                delegatorRewards.push({
                    name: customStakePoolReward.name,
                    description: customStakePoolReward.description,
                    image: customStakePoolReward.image,
                    url: customStakePoolReward.url,
                    assetId: customStakePoolReward.assetId,
                    amount: parseInt(walletStake.amount),
                    decimals: customStakePoolReward.decimals,
                    displayAmount: numberFormatter.format(parseInt(walletStake.amount)/(10**customStakePoolReward.decimals))
                })
            }
        }

        // Fetch project delegator rewards
        const delegatorStakeRewards = await StakeReward.find({delegatorReward: true, active: true}).exec()
        for (const stakeReward of delegatorStakeRewards) {
            if (stakeReward.delegatorRewardAmountPerEpoch > stakeReward.balance - stakeReward.reservedBalance) {
                logging.info(`Not enough tokens of ${stakeReward.name} ${stakeReward.assetId} to fulfill delegator rewards`)
                continue
            }
            delegatorRewards.push({
                name: stakeReward.name,
                description: stakeReward.description,
                image: stakeReward.image,
                url: stakeReward.url,
                assetId: stakeReward.assetId,
                amount: stakeReward.delegatorRewardAmountPerEpoch,
                decimals: stakeReward.decimals,
                displayAmount: numberFormatter.format(stakeReward.delegatorRewardAmountPerEpoch/(10**stakeReward.decimals))
            })
        }
    }

    // Fetch asset staking rewards
    let assetRewards = []
    const walletAssets = await cardano.queryAssetsForStakeAddress(stakeAddress)
    if (walletAssets == null) {
        logging.error('Could not fetch wallet assets')
        return {success: false, message: `There was an error fetching your wallet assets. Please try again later.`}
    }

    for (const walletAsset of walletAssets) {
        let relevantAssetId = undefined
        // Check if the asset is relevant
        for (const relevantPolicy of relevantStakeAssetPolicyIds) {
            if (walletAsset.unit.startsWith(relevantPolicy)) {
                relevantAssetId = walletAsset.unit.replace(relevantPolicy, relevantPolicy+'.')
            }
        }
        if (relevantAssetId == null) {
            continue
        }

        // Fetch the stake asset
        const stakeAsset = await StakeAsset.findOne({assetId: relevantAssetId}).exec()
        if (stakeAsset == null) {
            logging.info(`Could not find stake asset for asset id ${relevantAssetId}`)
            continue
        }

        // Check if the stake asset is active
        if (stakeAsset.active === false) {
            continue
        }

        // Check if only a specific project should be returned
        if (assetProjects != null && assetProjects.includes(stakeAsset.project) === false) {
            continue
        }

        // Calculate the rewards for this asset
        const now = new Date()
        const unclaimedDays = (now - stakeAsset.lastClaim) / 1000 / 60 / 60 / 24;
        let rewardAmount = Math.floor(unclaimedDays*stakeAsset.rewardAmountPerDay)
        if (rewardAmount > stakeAsset.maximumReward) {
            rewardAmount = stakeAsset.maximumReward
        }
        if (rewardAmount < 0) {
            continue
        }

        // Fetch the reward object
        const stakeReward = await StakeReward.findById(stakeAsset.reward).exec()
        if (stakeReward == null) {
            logging.info(`Could not find stake reward ${stakeAsset.reward}`)
            continue
        }

        // Check if the stake reward is active
        if (stakeReward.active === false) {
            continue
        }

        assetRewards.push({
            stakeAssetId: stakeAsset.assetId,
            stakeAssetName: stakeAsset.name,
            stakeAssetLastClaim: stakeAsset.lastClaim,
            stakeAssetProject: stakeAsset.project,
            name: stakeReward.name,
            description: stakeReward.description,
            image: stakeAsset.image,
            url: stakeReward.url,
            assetId: stakeReward.assetId,
            amount: rewardAmount,
            decimals: stakeReward.decimals,
            displayAmount: numberFormatter.format(rewardAmount/(10**stakeReward.decimals))
        })
    }

    assetRewards.sort((a,b) => (a.stakeAssetProject > b.stakeAssetProject) ? 1 : ((b.stakeAssetProject > a.stakeAssetProject) ? -1 : 0))

    if (delegatorRewards.length === 0 && assetRewards.length === 0) {
        logging.info(`Wallet ${inputAddress} does not qualify for any rewards`)
        return {success: false, message: `Your wallet does not qualify for any rewards`}
    }

    logging.info(`Successfully fetched rewards for wallet ${inputAddress}`)
    return {success: true, assetRewards: assetRewards, delegatorRewards: delegatorRewards, stakeAddress: stakeAddress, serviceFee: serviceFee, epoch: epochDetails.epoch}
}
exports.calculateRewards = calculateRewards

const getClaimSession = async (session) => {
    const claim = await StakeClaim.findOne({
        sessionId: session,
    }, ['-_id', 'sessionId', 'paymentAddress', 'paymentAmount', 'assets', 'assetsReadable', 'expiresAt', 'stakeAddress', 'serviceFee', 'status', 'actionHash']).exec()
    if (claim == null) {
        return {success: false, message: 'Not found'}
    } else {
        return {...{success: true}, ...claim.toJSON()}
    }
}
exports.getClaimSession = getClaimSession

const createClaimSession = async (inputAddress, assetProjects, delegatorRewards, assetRewards) => {
    //return {success: false, message: 'Claiming is currently disabled, please check back later'}
    const numberFormatter = new Intl.NumberFormat('en', {maximumFractionDigits: 2})

    // Calculate the rewards
    const checkWallet = await calculateRewards(inputAddress, assetProjects)
    if (checkWallet.success !== true) {
        return checkWallet
    } else if (checkWallet.session != null) {
        return checkWallet
    }

    // Payout assets
    let assets = {}
    let assetsReadable = {}

    // Check if requested delegator rewards are contained
    for (const [key, value] of Object.entries(delegatorRewards)) {
        // Check if value is formatted correctly
        if (typeof delegatorRewards[key] !== 'number') {
            console.log(inputAddress, delegatorRewards)
            logging.error('Requested asset amount was not a number')
            return {success: false, message: 'Something went wrong'}
        }

        // Check if the reward is valid
        const reward = checkWallet.delegatorRewards.find(e => e.assetId === key)
        if (reward == null) {
            logging.error(`Evil Request`)
            return {success: false, message: 'Don\'t be evil'}
        }

        // Check if the requested amount is valid
        if (value > reward.amount) {
            logging.error(`Greedy Request`)
            return {success: false, message: 'Don\'t be greedy'}
        }

        // Accumulate the asset rewards
        if (assets[reward.assetId] != null) {
            assets[reward.assetId] = assets[reward.assetId] + value
            assetsReadable[reward.name] = assetsReadable[reward.name] + (value/(10**reward.decimals))
        } else {
            assets[reward.assetId] = value
            assetsReadable[reward.name] = value/(10**reward.decimals)
        }
    }

    // Check if requested asset rewards are contained
    for (const [key, value2] of Object.entries(assetRewards)) {
        let value = value2
        // Check if value is formatted correctly
        if (typeof assetRewards[key] !== 'number') {
            console.log(inputAddress, assetRewards)
            logging.error('Requested asset amount was not a number')
            return {success: false, message: 'Something went wrong'}
        }


        const reward = checkWallet.assetRewards.find(e => e.stakeAssetId === key)


        // Check if the reward is valid
        if (reward == null) {
            logging.error(`Evil Request`)
            return {success: false, message: 'Don\'t be evil'}
        }

        if (value > reward.amount) {
            logging.error(`Greedy Request for reward ${reward.assetId} ${value}>${reward.amount}`)
            return {success: false, message: 'Don\'t be greedy'}
        }

        // Accumulate the asset rewards
        if (assets[reward.assetId] != null) {
            assets[reward.assetId] = assets[reward.assetId] + value
            assetsReadable[reward.name] = assetsReadable[reward.name] + (value/(10**reward.decimals))
        } else {
            assets[reward.assetId] = value
            assetsReadable[reward.name] = value/(10**reward.decimals)
        }
    }

    // Remove zero rewards
    for (const [key, value] of Object.entries(assets)) {
        if (value === 0) {
            delete assets[key]
        }
    }
    for (const [key, value] of Object.entries(assetsReadable)) {
        if (parseFloat(value) === 0) {
            delete assetsReadable[key]
        }
    }
    for (const [key, value] of Object.entries(assetRewards)) {
        if (value === 0) {
            delete assetRewards[key]
        }
    }


    // Calculate the number of assets
    let numberOfAssets = 0
    for (const [key, value] of Object.entries(assets)) {
        if (value > 0) {
            numberOfAssets += 1
        }
    }
    if (numberOfAssets === 0) {
        return {success: false, message: 'No rewards requested'}
    }

    // Calculate payment amount
    let paymentAmount = 2_000_000 + (1_000_000 * (Math.ceil(numberOfAssets / 5)))
    paymentAmount += checkWallet.serviceFee

    // Check if there is an open claim session
    if ((await StakeClaim.findOne({stakeAddress: checkWallet.stakeAddress, status: 'OPEN'}).exec()) != null) {
        logging.info(`There is already an open claim session for stake address ${checkWallet.stakeAddress}`)
        return {success: false, message: 'There is already an open claim session for your wallet'}
    }

    // Reserve the rewards tokens
    for (const [key, value] of Object.entries(assets)) {
        const stakeReward = await StakeReward.findOne({assetId: key}).exec()
        if (stakeReward == null) {
            logging.error(`No rewards found for asset id ${key}`)
            return {success: false, message: 'Impossible... No stake reward found'}
        }

        // Check if the reward balance minus reserved tokens is enough
        if (stakeReward.balance - stakeReward.reservedBalance < value) {
            logging.error(`Not enough rewards left for asset id ${key}`)
            return {success: false, message: 'Oh, we don\'t have enough tokens to send your rewards. Please contact the project for which you want to claim rewards.'}
        }

        // Reserve tokens
        stakeReward.reservedBalance = stakeReward.reservedBalance+value
        logging.info(`Reserved ${value} token of asset ${key}`)
        await stakeReward.save()
    }

    // Check if there is an open claim session
    if ((await StakeClaim.findOne({stakeAddress: checkWallet.stakeAddress, status: 'OPEN'}).exec()) != null) {
        logging.error(`There is already an open claim session for stake address ${checkWallet.stakeAddress} but tokens are reserved`)
        return {success: false, message: 'There is already an open claim session for your wallet'}
    }

    for (const [key, value] of Object.entries(assetsReadable)) {
        assetsReadable[key] = numberFormatter.format(value)
    }

    // Create a Claim Session
    const sessionId = randomHexString(10)
    const expiresAt = getExpiresDate()
    const claim = new StakeClaim({
        sessionId: sessionId,
        stakeAddress: checkWallet.stakeAddress,
        status: 'OPEN',
        projects: assetProjects,
        paymentAddress: faucetAddress,
        paymentAmount: paymentAmount,
        serviceFee: checkWallet.serviceFee,
        expiresAt: expiresAt,
        assets: assets,
        assetsReadable: assetsReadable,
        delegatorRewards: delegatorRewards,
        assetRewards: assetRewards,
        epoch: checkWallet.epoch,
        month: getNormalizedMonth(),
        quarter: getNormalizedQuarter(),
        year: getNormalizedYear()
    })
    await claim.save()

    logging.info(`Created claim session ${sessionId} for wallet ${checkWallet.stakeAddress}`)

    return getClaimSession(sessionId)
}
exports.createClaimSession = createClaimSession

const getExpiresDate = () => {
    const date = new Date()
    date.setHours(date.getHours() + 6);
    return date
}

const getNormalizedMonth = () => {
    const date = new Date()
    const yearSince2020 = date.getFullYear() - 2020
    return date.getMonth() + 1 + (yearSince2020 * 12)
}

const getNormalizedQuarter = () => {
    const date = new Date()
    const quarter = Math.floor((date.getMonth() + 3) / 3);
    const yearSince2020 = date.getFullYear() - 2020
    return quarter + (yearSince2020 * 4)
}

const getNormalizedYear = () => {
    const date = new Date()
    const yearSince2020 = date.getFullYear() - 2020
    return yearSince2020
}

const quantityOfAssetId = (balances, assetId) => {
    if (balances.length === 0) {
        return 0
    }
    const filtered = balances.filter(e => e.unit.startsWith(assetId))
    let balance = 0
    for (const object of filtered) {
        balance += parseInt(object.quantity)
    }
    return balance
}

const randomHexString = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
