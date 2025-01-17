const createMetaMaskProvider = require('metamask-extension-provider');
const { address, abi } = require('./constants')

console.log('psl', psl)
console.log('ethers', window.ethereum)
let domain = ''
// console.log('window', window)

const env = {
    host: 'https://8md2nmtej9.execute-api.ap-northeast-1.amazonaws.com',
    alertPeriod: 4 * 30 * 86400 * 1000
}

let url = window.location.host
function closeInternetVigilance() {
    document.getElementById("internetVigilanceBackdrop").style.display = 'none';
}

function closeInternetVigilanceWithNoMoreShow() {
    document.getElementById("internetVigilanceBackdrop").style.display = 'none';
    chrome.storage.sync.get([url], function(items) {
        console.debug('closeInternetVigilanceWithNoMoreShow', items, url, new Date())
        if(items[url]) {
            let data = items[url]
            data.dontShowAgain = true;
            let save = {}
            save[url] = data
            chrome.storage.sync.set(save, function() {
                console.log('saved dont show again', url);
            });
        }
    })
}

var alertIframe = document.createElement('iframe'); 
alertIframe.style.background = "none";
alertIframe.style.height = "100%";
alertIframe.style.width = "0px";
alertIframe.style.position = "fixed";
alertIframe.style.top = "0px";
alertIframe.style.right = "0px";
alertIframe.style.zIndex = "9000000000000000000";
alertIframe.src = chrome.runtime.getURL("alert.html")
document.body.appendChild(alertIframe);

function injectedAlert() {
    alertIframe.style.width="420px";
}

let provider = createMetaMaskProvider();
provider.on('chainChanged', (chainId) => {
    console.log('chainChanged', chainId)
    onUpdateChainID(parseInt(chainId))
});
provider.on('disconnect', (error) => {
    console.log('disconnect', error)
});
provider.on('connect', (connectInfo) => {
    console.log('connect', connectInfo)
    onUpdateChainID(parseInt(connectInfo.chainId))
});
provider.on('accountsChanged', (accounts) => {
    console.log('accountsChanged', accounts)
    onAccountChange(accounts[0])
});

function onUpdateChainID(chainId) {
    chrome.runtime.sendMessage({type: "chainID", data: {chainId}}, function(response) {
        console.log('message cb: onUpdateChainID', response);
    });
}

function onAccountChange(account) {
    console.log("Account:", account);

    chrome.runtime.sendMessage({type: "wallet-connected", data: {account}}, function(response) {
        console.log('message cb: onAccountChange', response);
    });
}

function onTransactionUpdate(txName, txHash, isSuccess, error) {
    console.log("onTransactionUpdate:", {
        txName, txHash, isSuccess, error
    });
    chrome.runtime.sendMessage({type: "transaction-update", data: {
        txName, txHash, isSuccess, error
    }}, function(response) {
        console.log('message cb: onTransactionUpdate', response);
    });
}

async function getStakeAmount() {
    let _provider = new ethers.providers.Web3Provider(provider, "any");
    const contract = new ethers.Contract(address, abi, _provider);
    let stakeAmount = await contract.stakingAmount();
    console.log('stakeAmount', stakeAmount)
    stakeAmount = parseFloat(ethers.utils.formatEther(stakeAmount))
    chrome.runtime.sendMessage({type: "stake-amount", data: {
        stakeAmount
    }}, function(response) {
        console.log('message cb: getStakeAmount', response);
    });
}

async function submitReport(isFraud, imageUrls, comments, stakeETH) {
    console.log('submitting report', {
        isFraud, imageUrls, comments, stakeETH
    })
    let _provider = new ethers.providers.Web3Provider(provider, "any");
    const contract = new ethers.Contract(address, abi, _provider);
    let tx;
    try {
        let value = ethers.utils.hexValue(ethers.utils.parseEther(stakeETH + '', 18))
        // tx = await provider.send('report', [domain, isFraud, imageUrls, comments])
        let data = await contract.populateTransaction.report(domain, isFraud, imageUrls, comments);
        const transactionParameters = {
            to: address, // Required except during contract publications.
            from: provider.selectedAddress,
            value, // Only required to send ether to the recipient from the initiating external account.
            data: data.data
        };

        const tx = await provider.request({
            method: 'eth_sendTransaction',
            params: [transactionParameters],
        });

        let interval = setInterval(async () => {
            const receipt = await provider.request({
                method: 'eth_getTransactionReceipt',
                params: [tx],
            });
            console.log('submitReport', receipt, receipt?.status)
            let status = parseInt(receipt?.status)
            if(status == 1 || status == 0) {
                onTransactionUpdate('submit-report', tx, true, null)
                clearInterval(interval)
            }
        }, 5000)

    } catch(err) {
        console.warn('error submit report', err)
        let error = err.message || "Something went wrong"
        onTransactionUpdate('submit-report', tx, false, error)
    }
}

async function connectWallet() {
    console.log('connect wallet', ethers)
    console.log('provider', provider)
    // const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    // const provider = await detectEthereumProvider()
    if(provider) {
        // Prompt user for account connections
        await provider.send("eth_requestAccounts", []);
        const account = provider.selectedAddress
        onAccountChange(account)        
    } else {
        alert('no provider')
    }
}

async function checkDomain() {
    console.log(url)
    var parsed = psl.parse(url);
    console.log('parsed url', parsed)
    url = parsed.domain;
    domain = url
    let count = 0
    let interval = setInterval(() => {
        chrome.storage.sync.get([url], function(items) {
            console.debug(items, url, new Date())
            if(items[url]) {
                clearInterval(interval)
                let dontShowAgain = items[url].dontShowAgain
                let createdon = new Date(items[url].createdon)
                let now = new Date()
                if(dontShowAgain) {
                    console.log('user opted to not show again')
                    return;
                }
                if((now.getTime() - createdon.getTime()) < env.alertPeriod) {
                    console.log('Vigilance DAO: domain is new. trigger.')
                    injectedAlert()
                } else {
                    console.log('Vigilance DAO: domain is old enough')
                }
            }
        })
        if(count > 100) {
            clearInterval(interval)
        }
        count += 1
    }, 1000)
}

checkDomain()

async function changeNetwork(chainID) {
    let chainIDHex = ethers.utils.hexValue(chainID)
    await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIDHex }], // chainId must be in hexadecimal numbers
    });
    let chainId = parseInt(provider.chainId)
    onUpdateChainID(chainId)
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    console.log('on message', msg, sender)
    if(msg && msg.type == "toggle"){
        toggle();
        sendResponse()
    } else if(msg && msg.type == 'connect-wallet-2') {
        await connectWallet()
    } else if(msg && msg.type == 'switch-network-2') {
        await changeNetwork(msg.data.chainID)
    } else if(msg && msg.type == 'submit-report-2') {
        await submitReport(msg.data.isFraud, msg.data.imageUrls, msg.data.comments, msg.data.stakeETH)
    } else if(msg && msg.type == 'get-stake-amount-2') {
        await getStakeAmount()
    }
});

var iframe = document.createElement('iframe'); 
iframe.style.background = "none";
iframe.style.height = "100%";
iframe.style.width = "0px";
iframe.style.position = "fixed";
iframe.style.top = "0px";
iframe.style.right = "0px";
iframe.style.zIndex = "9000000000000000000";
iframe.frameBorder = "none"; 
iframe.src = chrome.runtime.getURL("index.html")
document.body.appendChild(iframe);
// iframe.innerHTML
function toggle(){
    if(iframe.style.width == "0px"){
        iframe.style.width="420px";
    }
    else{
        iframe.style.width="0px";
    }
    // injectWindow()
    // console.log(iframe.innerHTML)
    // var div = document.createElement(iframe.innerHTML);

    // var xhr = typeof XMLHttpRequest != 'undefined' ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
    // xhr.open('get', iframe.src, true);
    // xhr.onreadystatechange = function() {
    //     if (xhr.readyState == 4 && xhr.status == 200) { 
    //         var div = document.createElement('div');
    //         div.className = 'myname'
    //         div.innerHTML = xhr.responseText
    //         document.body.prepend(div)
    //     } 
    // }
    // xhr.send();

    // console.log('runtime', chrome.runtime.sendMessage)
    // chrome.runtime.sendMessage({type: "take-screenshot"}, function(response) {
    //     console.log('message cb', response);
    // });
}

