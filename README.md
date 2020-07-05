# Stablescrow Escrows 

## Running the tests

This project uses Truffle for tests. Truffle's version of `solc` needs to be at least 0.5.11 for the contracts to compile.
Open your console and run:

    $ git clone git@github.com:jpgonzalezra/stablescrow-contract.git
    $ cd stablescrow-contract
    $ npm install

Now in one console, open the ganache-cli:

    $ ./node_modules/.bin/ganache-cli

And in other console(in the same folder), run the tests with truffle:

    $ ./node_modules/.bin/truffle test

# Migrations

#### Ropsten

TestToken1
---------------------
> transaction hash:    0x0e61075d59be92ffb7896a7f4b7e6b96406cf1a531f652510394517810db4448
> contract address:    0x30A4C935cBf7F94271677Fca108af225566F8452
> account:             0xa975D1DE6d7dA3140E9e293509337373402558bE

TestToken2
----------------------
> transaction hash:    0x0091bf758166060642c1588020efc3f5b1d0fdfb93c4d2bdbc1fe48eaf6fefec
> contract address:    0x2a28A3fa602CF891D2e219A4aB5f41DB59505223
> account:             0xa975D1DE6d7dA3140E9e293509337373402558bE

Stablescrow'
-----------------------
> transaction hash:    0x2892071619cb12b3a9001d7a5955f3a2f50f518acc6f388aa21e889e72920c6f
> contract address:    0xCb67B1297B170153E433E215e1D51658728022Ea
> account:             0xa975D1DE6d7dA3140E9e293509337373402558bE