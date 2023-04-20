const Web3 = require('web3');
const Tx = require('ethereumjs-tx').Transaction;

const web3 = new Web3('https://mainnet.infura.io/v3/your_project_id');

const WALLET_ADDRESS = '0x123...';
const WALLET_PRIVATE_KEY = Buffer.from('your_wallet_private_key', 'hex');
const DESTINATION_ADDRESS = '0x456...';

async function getERC20TokenTransferHistory(walletAddress) {
  const transfers = [];
  const tokenContracts = {};

  const transactions = await web3.eth.getTransactions(walletAddress);

  for (const tx of transactions) {
    const receipt = await web3.eth.getTransactionReceipt(tx.hash);

    if (receipt && receipt.logs) {
      for (const log of receipt.logs) {
        try {
          const tokenContract = log.address;
          const tokenData = await getTokenData(tokenContract);

          if (tokenData.isERC20) {
            const from = log.topics[1].slice(26);
            const to = log.topics[2].slice(26);
            const value = web3.utils.toBN(log.data);

            transfers.push({
              from,
              to,
              value,
              tokenContract,
              tokenData,
              txHash: receipt.transactionHash,
            });

            if (!tokenContracts[tokenContract]) {
              tokenContracts[tokenContract] = {
                tokenData,
                balance: await getTokenBalance(
                  tokenData.contractAddress,
                  walletAddress
                ),
              };
            }
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  return { transfers, tokenContracts };
}

async function getTokenBalance(tokenContractAddress, walletAddress) {
  const contract = new web3.eth.Contract(ERC20_ABI, tokenContractAddress);
  const balance = await contract.methods.balanceOf(walletAddress).call();

  return web3.utils.toBN(balance);
}

async function getTokenData(tokenContractAddress) {
  const contract = new web3.eth.Contract(ERC20_ABI, tokenContractAddress);
  const name = await contract.methods.name().call();
  const symbol = await contract.methods.symbol().call();
  const decimals = parseInt(await contract.methods.decimals().call(), 10);
  const totalSupply = web3.utils.toBN(
    await contract.methods.totalSupply().call()
  );
  const contractAddress = contract.options.address;
  const isERC20 =
    typeof name === 'string' &&
    typeof symbol === 'string' &&
    typeof decimals === 'number' &&
    totalSupply.gt(web3.utils.toBN(0));

  return {
    name,
    symbol,
    decimals,
    totalSupply,
    contractAddress,
    isERC20,
  };
}

async function transferToken(
  tokenContractAddress,
  walletPrivateKey,
  destinationAddress
) {
  const tokenData = await getTokenData(tokenContractAddress);
  const balance = await getTokenBalance(tokenContractAddress, WALLET_ADDRESS);

  const gasPrice = await web3.eth.getGasPrice();
  const gasLimit = await web3.eth.estimateGas({
    from: WALLET_ADDRESS,
    to: tokenContractAddress,
    data: tokenData.contract.methods
      .transfer(destinationAddress, balance)
      .encodeABI(),
  });

  const nonce = await web3.eth.getTransactionCount(WALLET_ADDRESS, 'pending');

  const txParams = {
    nonce: web3.utils.toHex(nonce),
    gasPrice: web3.utils.toHex(gasPrice),
    gasLimit: web3.utils.toHex(gasLimit),
    to: tokenContractAddress,
    value: '0x0',
    data: tokenData.contract.methods
      .transfer(destinationAddress, balance)
      .encodeABI(),
  };

  const tx = new Tx(txParams, { chain: 'mainnet' });
  tx.sign(walletPrivateKey);

  const serializedTx = tx.serialize();
  const txHash = await web3.eth.sendSignedTransaction(
    '0x' + serializedTx.toString('hex')
  );

  console.log(
    `Transferred ${web3.utils.fromWei(balance)} ${
      tokenData.symbol
    } from ${WALLET_ADDRESS} to ${destinationAddress}: ${txHash}`
  );
}

async function transferAllTokensToDestination(
  walletAddress,
  walletPrivateKey,
  destinationAddress
) {
  const { transfers, tokenContracts } = await getERC20TokenTransferHistory(
    walletAddress
  );

  for (const tokenContractAddress in tokenContracts) {
    const tokenContract = tokenContracts[tokenContractAddress];
    if (tokenContract.balance.gt(web3.utils.toBN(0))) {
      await transferToken(
        tokenContractAddress,
        walletPrivateKey,
        destinationAddress
      );
    }
  }
}

transferAllTokensToDestination(
  WALLET_ADDRESS,
  WALLET_PRIVATE_KEY,
  DESTINATION_ADDRESS
);
