// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./utils/Ownable.sol";
import "./utils/SafeMath.sol";

contract DP2P is Ownable {
    
    using SafeMath for uint256;
    using ECDSA for bytes32;

    // User Events

    event CreateAndDeposit(
        bytes32 _id,
        address _agent,
        address _seller,
        address _buyer,
        uint256 _balance,
        uint256 _platformAmount,
        address _token
    );
    event ReleaseWithSellerSignature(
        bytes32 _id,
        address _sender,
        address _to,
        uint256 _toAmount,
        uint256 _toAgent
    );
    event DisputeResolved(
        bytes32 _id,
        address _sender,
        address _to,
        uint256 _toAmount,
        uint256 _toAgent
    );
    event Cancel(bytes32 _id, uint256 _amount);
    event EscrowComplete(bytes32 _id, address _buyer);

    // Platform events

    event SetFee(uint256 _fee);
    event NewAgent(address _agent, uint256 _fee);
    event RemoveAgent(address _agent);

    struct Escrow {
        address agent;
        address seller;
        address buyer;
        address token;
        uint256 balance;
        uint128 agentFee;
        uint128 frozenTime;
    }
    // 10000 -> 100%
    // 1000  -> 10%
    // 100   -> 1%
    uint256 internal constant MAX_PLATFORM_FEE = 100; 
    uint256 internal constant MAX_AGENT_FEE = 1000; // 10%
    uint256 public platformFee;

    mapping(address => uint256) public platformBalanceByToken;
    mapping(address => uint256) public agentFeeByAgentAddress;
    mapping(bytes32 => Escrow) public escrows;

    /**
        @notice set a new plataform fee
        @param _platformFee uint32 of plataform fee.
        @dev 1- the sender must be owner of this contract
        @dev 2- the _plataformFee must be less than MAX_PLATFORM_FEE
    */
    function setPlatformFee(uint32 _platformFee) external onlyOwner {
        require(
            _platformFee <= MAX_PLATFORM_FEE,
            "setPlatformFee: invalid-fee"
        );
        platformFee = _platformFee;
        emit SetFee(_platformFee);
    }

    /**
        @notice withdrawn all plataform fee and send it to _to address
        @param _tokenAddresses address of token to do withdraw
        @param _to address where the tokens will go
        @dev the sender must be owner of this contract
    */
    function platformWithdraw(address[] calldata _tokenAddresses, address _to)
        external
        onlyOwner
    {
        require(_to != address(0), "platformWithdraw: error-transfer");
        for (uint256 i = 0; i < _tokenAddresses.length; i++) {
            address tokenAddress = _tokenAddresses[i];
            uint256 amount = platformBalanceByToken[tokenAddress];
            if (amount == 0) continue;
            platformBalanceByToken[tokenAddress] = 0;
            require(
                IERC20(tokenAddress).transfer(_to, amount),
                "platformWithdraw: error-transfer"
            );
        }
    }

    /**
        @notice add new agent to operate with the contract
        @param _agentAddress address of agent
        @param _fee uint256 of agent price to use it
        @dev the sender must be owner of this contract
    */
    function newAgent(address _agentAddress, uint256 _fee) external onlyOwner {
        require(_agentAddress != address(0), "newAgent: invalid-address");
        require(
            _fee > 0 && _fee <= MAX_AGENT_FEE,
            "newAgent: invalid-agent-fee"
        );
        require(
            agentFeeByAgentAddress[_agentAddress] == 0,
            "newAgent: invalid agent"
        );
        agentFeeByAgentAddress[_agentAddress] = _fee;
        emit NewAgent(_agentAddress, _fee);
    }

    /**
        @notice remove an agent
        @param _agentAddress address of agent.
        @dev the sender must be owner of this contract
    */
    function removeAgent(address _agentAddress) external onlyOwner {
        require(_agentAddress != address(0), "removeAgent: invalid-address");
        require(
            agentFeeByAgentAddress[_agentAddress] > 0,
            "removeAgent: invalid-agent"
        );
        delete agentFeeByAgentAddress[_agentAddress];
        emit RemoveAgent(_agentAddress);
    }

    /**
        @notice deposit an amount in the escrow after creating this
        @dev create and deposit tokens in the escrow,
             the seller of the escrow must be the sender
        @param _amount uint256 of amount to deposit.
        @param _agent address of agent.
        @param _buyer address of buyer.
        @param _token address of token to operate.
        @param _frozenTime uint128 of frozenTime in hours in orden to have an escrow open.
        @param _salt uint256 value that is generated at random
        @return id escrow identifier 
    */
    function createAndDeposit(
        uint256 _amount,
        address _agent,
        address _buyer,
        address _token,
        uint128 _frozenTime,
        uint256 _salt
    ) public returns (bytes32 id) {
        require(_token != address(0), "createAndDeposit: invalid-address");
        address seller = msg.sender;
        require(seller != _buyer, "createAndDeposit: invalid-buyer-seller");
        require(
            _agent != _buyer && _agent != seller,
            "createAndDeposit: invalid-buyer-agent-seller"
        );
        require(
            agentFeeByAgentAddress[_agent] > 0,
            "createAndDeposit: invalid-agent"
        );
        // Calculate the escrow id
        uint128 agentFee = uint128(agentFeeByAgentAddress[_agent]);
        id = keccak256(
            abi.encodePacked(
                address(this),
                _agent,
                seller,
                _buyer,
                agentFee,
                _token,
                _frozenTime,
                _salt
            )
        );

        // Check if the escrow was created
        require(
            escrows[id].agent == address(0),
            "createAndDeposit: invalid-escrow"
        );

        // Transfer the tokens from the sender
        IERC20 token = IERC20(_token);
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "createAndDeposit: error-deposit"
        );

        // Assign the fee amount to platform
        uint256 platformAmount = _amount.fee(platformFee);
        platformBalanceByToken[_token] = platformBalanceByToken[_token].add(
            platformAmount
        );

        uint256 balance = _amount.sub(platformAmount);
        escrows[id] = Escrow({
            agent: _agent,
            seller: seller,
            buyer: _buyer,
            agentFee: agentFee,
            token: _token,
            balance: balance,
            frozenTime: _buyer == address(0) // frozenTime not apply when there is a buyer assigned
                ? uint128(block.timestamp + (_frozenTime * 1 hours))
                : 0 // buyer assigned
        });

        emit CreateAndDeposit(
            id,
            _agent,
            seller,
            _buyer,
            balance,
            platformAmount,
            _token
        );
    }

    /**
        @notice relase an amount from an escrow and send the tokens to the buyer address
        @param _id bytes of escrow id
        @param _sellerSignature bytes of seller signature after to sign `_id` 
        @dev the sender should be the buyer with the seller signature
    */
    function releaseWithSellerSignature(
        bytes32 _id,
        bytes calldata _sellerSignature
    ) external {
        Escrow memory escrow = escrows[_id];
        require(
            msg.sender == escrow.buyer &&
                escrow.seller == getSignerRecovered(_id, _sellerSignature),
            "releaseWithSellerSignature: invalid-sender-or-signature"
        );

        (uint256 toAmount, uint256 agentFee) = _withdraw(
            _id,
            escrow.buyer,
            true
        );
        emit ReleaseWithSellerSignature(
            _id,
            escrow.seller,
            escrow.buyer,
            toAmount,
            agentFee
        );
    }

    /**
        @notice the seller must call this method to withdraw they tokens if the agent decided to their favor
        @param _data bytes of escrow id
        @param _agentSignature agent signature for _id 
        @dev the seller must be the sender 
    */
    function resolveDisputeSeller(
        bytes calldata _data,
        bytes calldata _agentSignature
    ) external {
        (bytes32 id, address ownerSignature) = abi.decode(
            _data,
            (bytes32, address)
        );
        Escrow memory escrow = escrows[id];
        resolveDispute(
            id,
            escrow.seller,
            escrow.agent,
            ownerSignature,
            _data,
            _agentSignature
        );
    }

    /**
        @notice the buyer must call this method to withdraw they tokens if the agent decided to their favor
        @param _data bytes of escrow id
        @param _agentSignature agent signature for _id 
        @dev the buyer must be the sender
    */
    function resolveDisputeBuyer(
        bytes calldata _data,
        bytes calldata _agentSignature
    ) external {
        (bytes32 id, address ownerSignature) = abi.decode(
            _data,
            (bytes32, address)
        );
        Escrow memory escrow = escrows[id];
        resolveDispute(
            id,
            escrow.buyer,
            escrow.agent,
            ownerSignature,
            _data,
            _agentSignature
        );
    }

    /**
        @notice the buyer choose an escrow to operate
        @param _id bytes of escrow id
        @dev 1- the buyer address must be address(0)
        @dev 2- the frozenTime time must be gretter than block.timestamp, so the escrow will be deleted
    */
    function takeOverAsBuyer(bytes32 _id) external {
        Escrow storage escrow = escrows[_id];
        require(escrow.buyer == address(0), "takeOverAsBuyer: buyer-exist");
        require(
            block.timestamp < escrow.frozenTime,
            "takeOverAsBuyer: frozenTime-finished"
        );
        escrow.buyer = msg.sender;
        emit EscrowComplete(_id, escrow.buyer);
    }

    /**
        @notice cancel an escrow and send the escrow balance to the seller address
        @param _id bytes32 of escrow id
        @dev the sender must be owner, the escrow will be deleted
    */
    function cancel(bytes32 _id) external {
        Escrow memory escrow = escrows[_id];
        require(msg.sender == _owner, "cancel: invalid-sender");
        _cancel(_id, escrow.token, escrow.balance, escrow.seller);
    }

    /**
        @notice cancel an escrow by seller and send the escrow balance to him address
        @param _id bytes32 of escrow id
        @dev 1- the sender must be the seller
        @dev 2- the buyer escrow must be 0 (open escrow) 
        @dev 3- the frozen time must be less than current time  
    */
    function cancelBySeller(bytes32 _id) external {
        Escrow memory escrow = escrows[_id];
        address seller = escrow.seller;
        require(msg.sender == seller, "cancelBySeller: invalid-sender");
        require(escrow.buyer == address(0), "cancelBySeller: complete-escrow");
        require(
            block.timestamp > escrow.frozenTime,
            "cancelBySeller: invalid-frozen-time"
        );
        _cancel(_id, escrow.token, escrow.balance, seller);
    }

    // Internal functions

    /**
        @notice generic cancel an escrow
        @param _id bytes32 of escrow id
        @param _token address of token
        @param _balance uint256 of balance to return
        @dev this method can be execute through agent, owner or 
        @dev seller only if is a incomplete escrow
    */
    function _cancel(
        bytes32 _id,
        address _token,
        uint256 _balance,
        address _sender
    ) internal {
        // Delete escrow
        delete escrows[_id];
        // transfer tokens to the seller just if the escrow has balance
        if (_balance > 0) {
            require(
                IERC20(_token).transfer(_sender, _balance),
                "cancel: error-transfer"
            );
        }
        emit Cancel(_id, _balance);
    }

    /**
        @notice 
        @param _id bytes32 of escrow id.
        @param _sender address of sender. 
        @param _agent address of agent.
        @param _agentSignature bytes of agent signature.
        @dev 1- must be seller if was called from resolveDisputeSeller or
        @dev 2- must be buyer if was called from resolveDisputeBuyer or
        @dev 3- can be plataform to resolve dispute as a last alternative
    */
    function resolveDispute(
        bytes32 _id,
        address _sender,
        address _agent,
        address _ownerSignature,
        bytes calldata _data,
        bytes calldata _agentSignature
    ) internal {
        address sender = msg.sender;
        bool owner = sender == _owner;
        require(sender == _sender || owner, "resolveDispute: invalid-sender");
        if (!owner) {
            require(
                _agent ==
                    getSignerRecovered(
                        keccak256(_data),
                        _agentSignature
                    ) &&
                    sender == _ownerSignature,
                "resolveDispute: invalid-signature"
            );
        }
        (uint256 toAmount, uint256 agentFee) = _withdraw(_id, _sender, !owner);
        emit DisputeResolved(_id, _agent, _sender, toAmount, agentFee);
    }

    /**
        @notice get signer recovered with _data and _signature
        @param _data bytes32 of escrow id.
        @param _signature bytes of agent signature after to sign the escrow id `_data`
        @dev 
        @return address of signer recovered
    */
    function getSignerRecovered(bytes32 _data, bytes memory _signature)
        internal
        pure
        returns (address)
    {
        bytes32 messageHash = _data.toEthSignedMessageHash();
        return messageHash.recover(_signature);
    }

    /**
        @notice Withdraw an amount from an escrow and send to `_to` address
        @param _id bytes of escrow id
        @param _to the address where the tokens will go
        @param _withFee bool of fee
        @dev The sender should be the _approved or the agent of the escrow
    */
    function _withdraw(
        bytes32 _id,
        address _to,
        bool _withFee
    ) internal returns (uint256 toAmount, uint256 agentAmount) {
        Escrow storage escrow = escrows[_id];
        require(escrow.balance > 0, "_withdraw: not-balance");
        uint256 amount = escrow.balance;
        IERC20 token = IERC20(escrow.token);

        if (_withFee) {
            // calculate the fee
            agentAmount = amount.fee(escrow.agentFee);
            // substract the agent fee
            escrow.balance = escrow.balance.sub(agentAmount);
            toAmount = amount.sub(agentAmount);
            // send fee to the agent
            require(
                token.transfer(escrow.agent, agentAmount),
                "_withdraw: error-transfer-agent"
            );
        } else {
            // platform should not pay fee (override withFee to false)
            toAmount = amount;
        }

        // update escrow balance in storage
        escrow.balance = escrow.balance.sub(toAmount);
        // send amount to `_to` address
        require(token.transfer(_to, toAmount), "_withdraw: error-transfer-to");
    }
}