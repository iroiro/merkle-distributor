// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";

contract MerkleDistributorManager {
    mapping(uint256 => address) public tokenMap;
    mapping(uint256 => bytes32) public merkleRootMap;
    mapping(uint256 => uint256) public remainingAmountMap;

    // This is a packed array of booleans.
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    function isClaimed(uint256 campaignId, uint256 index) public view returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[campaignId][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint256 campaignId, uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        claimedBitMap[campaignId][claimedWordIndex] =
        claimedBitMap[campaignId][claimedWordIndex] | (1 << claimedBitIndex);
    }

    function claim(
        uint256 campaignId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) virtual public {
        require(!isClaimed(campaignId, index), 'MerkleDistributor: Drop already claimed.');
        require(amount <= remainingAmountMap[campaignId], "MerkleDistributor: Insufficient token.");

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        require(MerkleProof.verify(merkleProof, merkleRootMap[campaignId], node), 'MerkleDistributor: Invalid proof.');

        // Mark it claimed and send the token.
        _setClaimed(campaignId, index);
        require(IERC20(tokenMap[campaignId]).transfer(account, amount), 'MerkleDistributor: Transfer failed.');
        remainingAmountMap[campaignId] = remainingAmountMap[campaignId] - amount;

        emit Claimed(campaignId, index, account, amount);
    }

    event Claimed(uint256 campaignId, uint256 index, address account, uint256 amount);
}
