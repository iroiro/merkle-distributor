import { BigNumber } from 'ethers'
import BalanceTree from './string-balance-tree'

// This is the blob that gets distributed and pinned to IPFS.
// It is completely sufficient for recreating the entire merkle tree.
// Anyone can verify that all air drops are included in the tree,
// and the tree has no additional distributions.
export interface MerkleDistributorInfo {
  merkleRoot: string
  tokenTotal: string
  claims: {
    [hashed: string]: {
      index: number
      amount: string
      proof: string[]
    }
  }
}

export type OldFormat = { [hashed: string]: number | string }
export type NewFormat = { hashed: string; earnings: string; reasons: string }

export function parseStringBalanceMap(balances: OldFormat | NewFormat[]): MerkleDistributorInfo {
  // if balances are in an old format, process them
  const balancesInNewFormat: NewFormat[] = Array.isArray(balances)
    ? balances
    : Object.keys(balances).map(
        (hashed): NewFormat => ({
          hashed,
          earnings: `0x${balances[hashed].toString(16)}`,
          reasons: '',
        })
      )

  const dataByTarget = balancesInNewFormat.reduce<{
    [hashed: string]: { amount: BigNumber; flags?: { [flag: string]: boolean } }
  }>((memo, { hashed: target, earnings, }) => {
    if (memo[target]) throw new Error(`Duplicate target: ${target}`)
    const parsedNum = BigNumber.from(earnings)
    if (parsedNum.lte(0)) throw new Error(`Invalid amount for target: ${target}`)

    memo[target] = { amount: parsedNum }
    return memo
  }, {})

  const sortedAddresses = Object.keys(dataByTarget).sort()

  // construct a tree
  const tree = new BalanceTree(
    sortedAddresses.map((hashed) => ({ hashed , amount: dataByTarget[hashed].amount }))
  )

  // generate claims
  const claims = sortedAddresses.reduce<{
    [hashed: string]: { amount: string; index: number; proof: string[];  }
  }>((memo, hashed, index) => {
    const { amount } = dataByTarget[hashed]
    memo[hashed] = {
      index,
      amount: amount.toHexString(),
      proof: tree.getProof(index, hashed, amount),
    }
    return memo
  }, {})

  const tokenTotal: BigNumber = sortedAddresses.reduce<BigNumber>(
    (memo, key) => memo.add(dataByTarget[key].amount),
    BigNumber.from(0)
  )

  return {
    merkleRoot: tree.getHexRoot(),
    tokenTotal: tokenTotal.toHexString(),
    claims,
  }
}
