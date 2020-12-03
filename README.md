# DP2P contracts

## Install

First, install [Node.js](http://nodejs.org/) and [npm](https://yarnpkg.com/).

1- install OpenZeppelin SDK running
```sh
npm install --global @openzeppelin/cli
```

2- install dependencies running
```sh
npm install
```
> If you get an `EACCESS permission denied` error while installing, please refer to the [npm documentation on global installs permission errors](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally). Alternatively, you may run `sudo npm install --unsafe-perm --global @openzeppelin/cli`, but this is highly discouraged, and you should rather either use a node version manager or manually change npm's default directory.

## Deploy

- use `openzeppelin deploy` to create instances for these contracts that later can be upgraded.

## Running test

This project uses Truffle for tests. Truffle's version of `solc` needs to be at least for the contracts to compile.
Open your console and run:

    $ git clone git@github.com:jpgonzalezra/dp2p-contracts.git
    $ cd dp2p-contracts
    $ npm install

Now in one console, open the ganache-cli:

    $ ./node_modules/.bin/ganache-cli

And in other console(in the same folder), run the tests with truffle:

    $ ./node_modules/.bin/truffle test

## Storage preservation

```
|--------------------------------|
|Implementation_v1               |
|--------------------------------|
|address base                    |
|int maxPlataformFee             |
|int maxAgentFee                 |
|int platformFee                 |
|mapping platformBalanceByToken  |
|mapping agentFeeByAgentAddress  |
|mapping escrows                 |
```

## Addresses (Mainnet, Ropsten)

## Mainnet

### DP2P
contract address:    WIP

### DP2P DAI
contract address:    WIP

## Ropsten

### TestToken1
contract address:    0xDDf20B47E18f7d016B9db49C1a472B17EbD6a45F

### TestToken2
contract address:    0xd0f231CaB3b8976A00C23863118A223D2ea73ece

### DP2P
contract address:    0x1e804C29e1bda212F22d2E8C3421BeE48efA2fbb

### DP2P DAI
contract address:    WIP