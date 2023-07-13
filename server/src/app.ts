import express, { json } from 'express';
import helmet from 'helmet';
import { PoolClient } from 'pg';
import pool, { poolContracts } from './db';
import {ethers}  from 'ethers';
import fetch from 'node-fetch';
import { BasicDomainInfo, DomainInfo, DomainScamInfo } from "../../important-types";
const whois = require('whois-json');
const cors = require('cors');
const { sendMessage } = require('./telegramBot');

const app = express();
app.use(json());
app.use(helmet());
app.use(
	cors(),
);

app.post('/domain-info', async (req, res) => {
	// await captureWebsite.file('https://cryptnesis.com/', 'screenshot.png');

	let domain = req.body.domain
	console.log('domain', domain)
	if (!domain) {
		res.status(400).send({})
		return;
	}

	try {
		let client = await pool.connect()
		let output = await getDomainInfo(client, domain)
		client.release()
		res.json(output);
	} catch (err) {
		console.log('get domain details', err)
		res.status(500).send({})
	}
	return;
});

app.post("/contract-info", async (req, res) => {
  const address = req.body.address;
  const chain_id = req.body.chain_id;
  if (!address) {
	res.status(400).send({error: "Bad params"});
	return;
  }
  
  if (!chain_id || (chain_id != '1' && chain_id != '137')) {
	res.status(400).send({error: "Bad params"});
	return;
  }

  const network = chain_id == '1' ? 'ETHEREUM_MAINNET' : 'POLYGON_MAINNET';

  console.log("address", address);
  console.log("chain_id", chain_id);
  console.log("network", network);

  try {
    const client = await poolContracts.connect();
    const output = await getContractInfo(client, address, network);
    client.release();
    // res.json({
	// 	userCount24hours: 1000,
	// 	userCount30days: 100000,
	// 	creationDate: new Date((new Date().getTime() - 86400000)),
	// 	name: 'Dummy',
	// });
	res.json(output);
  } catch (err) {
    console.log("get contract details", err);
	sendMessage(`Error: /contract-info API:\nAddress: ${address}\nChain ID: ${chain_id}\nError: ${err}`)
    res.status(500).send({});
  }
  return;
});

app.use((_, res, _2) => {
	res.status(404).json({ error: 'NOT FOUND' });
});

async function getDomainCreatedInfoFromDb(client: PoolClient, domain: string): Promise<BasicDomainInfo | null> {
	const query = 'SELECT * from domains where domain=$1'

	try {
		const data = await client.query(query, [domain])
		if (data.rows.length && data.rows[0].isValid) {
			return data.rows[0] as BasicDomainInfo;
		} else {
			return null;
		}
	} catch (err) {
		console.log('error', err)
	}
	return null
}

async function getDomainScamInfoFromDb(client: PoolClient, domain: string): Promise<DomainScamInfo | null> {
	const query = 'SELECT "isScam", "fromSourceId", "attackType", "updatedOn" FROM "Edge" WHERE "destinationAddress"=$1';

	try {
		const data = await client.query(query, [domain]);
		if (data.rowCount > 0) {
			return data.rows[0] as DomainScamInfo;
		} else {
			return null;
		}
	} catch (err) {
		console.log("error", err);
	}

	return null;
}

async function getDomainInfo(client: PoolClient, domain: string): Promise<DomainInfo> {
	const domainInfo: DomainInfo = {
		domain,
	} as DomainInfo;

	const fromDb = await getDomainCreatedInfoFromDb(client, domain)
	if (fromDb) {
		console.log('loading from db', domain, fromDb)
		domainInfo.createdon = fromDb.createdon;
		domainInfo.updatedon = fromDb.updatedon;
		domainInfo.recordCreatedOn = fromDb.recordCreatedOn;
		domainInfo.isValid = fromDb.isValid;
	} else {
		const results = await whois(domain);
		console.log('reading new domain info', domain, results);
		domainInfo.createdon = new Date(results.creationDate)
		domainInfo.updatedon = new Date(results.updatedDate)
		domainInfo.isValid = true;

		let text = 'INSERT INTO domains(domain, createdon, updatedon) VALUES($1, $2, $3)'
		let values: any = [domain, domainInfo.createdon, domainInfo.updatedon]
		if (isNaN(domainInfo.createdon as any) || isNaN(domainInfo.updatedon as any)) {
			text = 'INSERT INTO domains(domain, "isValid") VALUES($1, $2)'
			values = [domain, false]
			domainInfo.isValid = false;
		}
		try {
			await client.query(text, values)
		} catch (err) {
			console.log('error', err)
		}
	}
	const scamInfoFromDb = await getDomainScamInfoFromDb(client, domain);
	if (scamInfoFromDb) {
		domainInfo.scamInfo = scamInfoFromDb;
	} else {
		// do nothing
	}

	return domainInfo;
}

function getEtherscanEndpoint(chain_id: string) {
	if (chain_id == Networks.ETHEREUM_MAINNET.valueOf()) {
		return 'https://api.etherscan.io/api'
	} else if (chain_id == Networks.POLYGON_MAINNET.valueOf()) {
		return 'https://api.polygonscan.com/api'
	} else {
		throw new Error('Invalid chain id')
	}
}

enum Networks {
	ETHEREUM_MAINNET = 'ETHEREUM_MAINNET',
	POLYGON_MAINNET = 'POLYGON_MAINNET',
}

function getEtherscanAPIkey(chain_id: string) {
	if (chain_id == Networks.ETHEREUM_MAINNET.valueOf()) {
		return process.env.ETHERSCAN_API_KEY
	} else if (chain_id == Networks.POLYGON_MAINNET.valueOf()) {
		return process.env.POLYGONSCAN_API_KEY
	} else {
		throw new Error('Invalid chain id')
	}
}

function getProvider(chain_id: string) {
	if (chain_id == Networks.ETHEREUM_MAINNET.valueOf()) {
		return new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
	} else if (chain_id == Networks.POLYGON_MAINNET.valueOf()) {
		return new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
	} else {
		throw new Error('Invalid chain id')
	}
}

function getEtherscanURL(chain_id: string) {
	if (chain_id == Networks.ETHEREUM_MAINNET.valueOf()) {
		return 'https://etherscan.io'
	}
	else if (chain_id == Networks.POLYGON_MAINNET.valueOf()) {
		return 'https://polygonscan.com'
	} else {
		throw new Error('Invalid chain id')
	}
}

async function getCreationDate(client: PoolClient, address: string, network: string): Promise<{
	riskRating: string,
	feedback: string[],
	name: string,
	date: string,
}> {
  try {
    const query = 'SELECT * FROM "ContractAddresses" WHERE "address" LIKE $1 AND "network" LIKE $2';
    var contractData = await client.query(query, [address, network]);  
    
    if(contractData.rowCount == 0){
      const query1 = 'INSERT INTO "ContractAddresses"("address", "network") VALUES($1, $2)';
      await client.query(query1, [address, network]);
      contractData = await client.query(query, [address, network]);
    }
    
	let { riskRating, feedback } = await getRiskRating(client, network, contractData.rows[0]);
    var date = contractData.rows[0].creationDate;
	var name = contractData.rows[0].contractName;
	var contractVerified = contractData.rows[0].contractVerified;
	var implementation = contractData.rows[0].implementation;

    if (date == "NA") {
		const ETHERSCAN_ENDPOINT = getEtherscanEndpoint(network);
		const _ETHERSCAN_API_KEY = getEtherscanAPIkey(network);
		const ETHERSCAN_URL = getEtherscanURL(network);
		const provider = getProvider(network);
		const response = await fetch(
			`${ETHERSCAN_ENDPOINT}?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${_ETHERSCAN_API_KEY}`
		);
			
		const data:any = await response.json();
			
		console.log('data', data)
		if (data.result == null) {
			return {
				riskRating,
				feedback,
				date: 'NA',
				name: 'NA',
			};
		}

		const response2 = await fetch(`${ETHERSCAN_ENDPOINT}?module=contract&action=getsourcecode&address=${address}&apikey=${_ETHERSCAN_API_KEY}`)

		const data2:any = await response2.json();
		console.log('data2', data2)

		const response3 = await fetch(`${ETHERSCAN_URL}/address/${address}`)
		const data3:any = await response3.text();

		const txHash = data.result[0].txHash;

		const tx = await provider.getTransaction(txHash);
		if (tx?.blockHash) {
			const block = await provider.getBlock(tx.blockHash);
		if(block) {
			date = new Date(block.timestamp * 1000);
			date = date.toISOString().slice(0, 10);
			} 
		} 

		if (data2.result == null || data2.result.length == 0) {
			const query2 = 'UPDATE "ContractAddresses" SET "creationDate"=$1 WHERE "address" LIKE $2 AND "network" LIKE $3';
			client.query(query2, [date, address, network]);
			let riskInfo = await getRiskRating(client, network, { verified: false, contractVerified: false, creationDate: date });
			riskRating = riskInfo.riskRating;
			feedback = riskInfo.feedback;
			return {
				riskRating,
				feedback,
				date,
				name: 'NA',
			}
		}

		contractVerified = data2.result[0].SourceCode ? true : false;
		implementation = data2.result[0].Implementation

		if (implementation) {
			await getCreationDate(client, implementation, network);
		}

		var title = data3.split('<title>')[1].split('</title>')[0]
		const titleArr = title.split('|')
		
		if(titleArr.length == 3) {
			name = titleArr[0].trim();
		} else {
			name = data2.result[0].ContractName;
		}

		console.log('name', name)
		const query2 = 'UPDATE "ContractAddresses" SET "creationDate"=$1, "contractName"=$3, "contractVerified"=$4, "implementation"=$5 WHERE "address" LIKE $2 AND "network" LIKE $6';
		client.query(query2, [date, address, name, contractVerified, implementation, network]);
		let riskInfo = await getRiskRating(client, network, { verified: false, contractVerified, creationDate: date, implementation });
		riskRating = riskInfo.riskRating;
		feedback = riskInfo.feedback;
    }
    return {
		riskRating,
		feedback,
		date,
		name,
	}

  } catch (error) {
    console.log(error);  
	sendMessage(`Error: getCreationDate API:\nAddress: ${address}\nNetwork: ${network}\nError: ${error}`)
  }
  return {
	riskRating: 'NA',
	feedback: [],
	date: 'NA',
	name: 'NA',
  };
}

async function getRiskRating(client: PoolClient, network: string, contractRecord: any) {
	console.log('contractRecord', contractRecord)
	if (!contractRecord) {
		return {
			riskRating: 'NA',
			feedback: []
		}
	}
	if (contractRecord.verified) {
		return {
			riskRating: 'LOW',
			feedback: ["Verified by Vigilance DAO"]
		}
	}
	let riskRating = 'MEDIUM';
	let feedback = [];
	
	// @todo // try proxy detection
  var implementationCreationDate;
  var implementationContractVerified = true;

	if(contractRecord.implementation) {
		feedback.push('Proxy contract');
		const query = 'SELECT * FROM "ContractAddresses" WHERE "address" LIKE $1 AND "network" LIKE $2';
    var contractData = await client.query(query, [contractRecord.implementation, network]);

		implementationContractVerified = contractData.rows[0].contractVerified;
    implementationCreationDate  = contractData.rows[0].creationDate;
	}

  if (!contractRecord.contractVerified || !implementationContractVerified) {
		feedback.push('Contract source code not verified');
	}

	let now = new Date();
	if ((now.getTime() - new Date(contractRecord.creationDate).getTime()) < 86400000 * 120 || 
  (now.getTime() - new Date(implementationCreationDate).getTime()) < 86400000 * 120 ) { // 120 days
		feedback.push('Contract is newly deployed. Maintain caution.');
	}
  
	if (feedback.length == 0) {
		riskRating = 'LOW';
	}
	return {
		riskRating,
		feedback,
	}
}

async function getContractInfo(client: PoolClient, address: string, network: string): Promise<any> {
  const now = new Date();

  var yesterday = new Date(now.setDate(now.getDate() - 1)).getTime() / 1000;
  var lastMonth = new Date(now.setDate(now.getDate() - 30)).getTime() / 1000;

  yesterday = Math.floor(yesterday);
  lastMonth = Math.floor(lastMonth);

  try {
    const query = 'SELECT SUM("count") FROM "TransactionCount" WHERE "to" LIKE $1 AND "time" > $2 AND network = $3';
	let t1 = new Date().getTime();
    const transactionsLast24Hours = await client.query(query, [address, yesterday, network]);

    const transactionsLast30Days = await client.query(query, [address, lastMonth, network]);
	let t2 = new Date().getTime();
    const { riskRating, feedback, name, date } = await getCreationDate(client, address, network);
	let t3 = new Date().getTime();
	console.log('time taken', t2 - t1, t3 - t2)
    return { 
      userCount24hours: transactionsLast24Hours.rows[0].sum,
      userCount30days: transactionsLast30Days.rows[0].sum,
      creationDate: date,
	  name,
	  riskRating,
	  feedback,
    };   
  }catch (error) {
    console.log(error);
  }
  return null;
}

export { app };

let isListening = false;
if (process.env.SERVER_TYPE == 'express' && !isListening) {
	app.listen(4000, () => {
		isListening = true;
		console.log('server listening on 4000')
	})
}