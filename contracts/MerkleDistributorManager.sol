// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";

contract MerkleDistributorManager {
    struct Distribution {
        address token;
        bytes32 merkleRoot;
        uint256 remainingAmount;
    }

    mapping(uint64 => Distribution) public distributionMap;

    // This is a packed array of booleans.
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBitMap;

    function isClaimed(uint64 campaignId, uint256 index) public view returns (bool) {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        uint256 claimedWord = claimedBitMap[campaignId][claimedWordIndex];
        uint256 mask = (1 << claimedBitIndex);
        return claimedWord & mask == mask;
    }

    function _setClaimed(uint64 campaignId, uint256 index) private {
        uint256 claimedWordIndex = index / 256;
        uint256 claimedBitIndex = index % 256;
        Distribution storage dist = distributionMap[campaignId];
        claimedBitMap[campaignId][claimedWordIndex] =
        claimedBitMap[campaignId][claimedWordIndex] | (1 << claimedBitIndex);
    }

    function claim(
        uint64 campaignId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) virtual public {
        require(!isClaimed(campaignId, index), 'MerkleDistributor: Drop already claimed.');
        Distribution storage dist = distributionMap[campaignId];
        require(amount <= dist.remainingAmount, "MerkleDistributor: Insufficient token.");

        // Verify the merkle proof.
        bytes32 node = keccak256(abi.encodePacked(index, account, amount));
        require(MerkleProof.verify(merkleProof, dist.merkleRoot, node), 'MerkleDistributor: Invalid proof.');

        // Mark it claimed and send the token.
        _setClaimed(campaignId, index);
        require(IERC20(dist.token).transfer(account, amount), 'MerkleDistributor: Transfer failed.');
        dist.remainingAmount = dist.remainingAmount - amount;

        emit Claimed(campaignId, index, account, amount);
    }

    event Claimed(uint64 campaignId, uint256 index, address account, uint256 amount);
}
