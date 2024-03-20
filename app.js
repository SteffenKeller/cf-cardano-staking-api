require('dotenv').config()
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const logging = require('./logging')
const staking = require('./staking')

let cachedDb = null;
function connectToDatabase() {
    if (cachedDb) {
        return Promise.resolve(cachedDb);
    }
    return mongoose.connect(process.env.DATABASE_URL)
    .then(db => { cachedDb = db; return cachedDb; });
}


app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,key');
    next();
});

app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.get('/status', async function (req, res) {
    res.json({status: 'OK'})
})

app.get('/rewards/:assetId', async function (req, res) {
    try {
        if (req.headers.key !== 'osEJzMECXAcTNy7HOo4I') {
            res.status(401).send()
            console.log('Unauthorized API Request for '+req.params.assetId)
            return
        }
        await connectToDatabase()
        const response = await staking.calculateRewardForAssetId(req.params.assetId)
        res.json(response)
    } catch(e) {
        logging.error(e)
        res.json({success: false, message: 'Internal Server Error'})
    }
})


app.post('/rewards', async function (req, res) {
    try {
        if (req.body.address == null || req.body.address === '') {
            res.json({success: false, message: 'Invalid Request'})
            return
        }
        await connectToDatabase()
        const response = await staking.calculateRewards(req.body.address, req.body.projects)
        res.json(response)
    } catch(e) {
        logging.error(e)
        res.json({success: false, message: 'Internal Server Error'})
    }
})

app.get('/claim', async function (req, res) {
    try {
        if (req.query.session == null || req.query.session === '') {
            res.json({success: false, message: 'Invalid Request'})
            return
        }
        await connectToDatabase()
        const response = await staking.getClaimSession(req.query.session)
        res.json(response)
    } catch(e) {
        logging.error(e)
        res.json({success: false, message: 'Internal Server Error'})
    }
})

app.post('/claim', async function (req, res) {
    try {
        if (req.body.address == null || req.body.address === '' || req.body.delegatorRewards == null || typeof req.body.delegatorRewards !== 'object' || req.body.assetRewards == null || typeof req.body.assetRewards !== 'object') {
            res.json({success: false, message: 'Invalid Request'})
            return
        }
        await connectToDatabase()
        const response = await staking.createClaimSession(req.body.address, req.body.projects, req.body.delegatorRewards, req.body.assetRewards)
        res.json(response)
    } catch(e) {
        logging.error(e)
        res.json({success: false, message: 'Internal Server Error'})
    }
})

app.listen(8080, function () {
    console.log('Listening on port 8080...')
});
