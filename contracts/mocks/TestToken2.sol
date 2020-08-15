// SPDX-License-Identifier: MIT
pragma solidity 0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// mock class using ERC20
contract TestToken2 is ERC20 {
    constructor() public payable ERC20("Test2", "TEST2") {
        _setupDecimals(6);
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function transferInternal(
        address from,
        address to,
        uint256 value
    ) public {
        _transfer(from, to, value);
    }

    function approveInternal(
        address owner,
        address spender,
        uint256 value
    ) public {
        _approve(owner, spender, value);
    }
}
