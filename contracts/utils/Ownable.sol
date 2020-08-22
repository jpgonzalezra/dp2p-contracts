// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../interfaces/IERC173.sol";


contract Ownable is IERC173 {
    address internal _owner;

    modifier onlyOwner() {
        require(
            msg.sender == _owner,
            "Owneable: The owner should be the sender"
        );
        _;
    }

    constructor() public {
        _owner = msg.sender;
        emit OwnershipTransferred(address(0x0), msg.sender);
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function transferOwnership(address _newOwner) external override onlyOwner {
        require(_newOwner != address(0), "0x0 Is not a valid owner");
        emit OwnershipTransferred(_owner, _newOwner);
        _owner = _newOwner;
    }
}
