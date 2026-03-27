package asichain

import "fmt"

// HelloWorldTerm returns the Rholang term for a simple hello-world deploy.
func HelloWorldTerm() string {
	return "new stdout(`rho:io:stdout`) in { stdout!(\"Hello, Blockchain!\") }"
}

// TransferTerm returns the Rholang term for an ASI vault transfer deploy.
func TransferTerm(fromAddr, toAddr string, amount int64) string {
	return fmt.Sprintf(`
new
  deployerId(`+"`rho:rchain:deployerId`"+`),
  stdout(`+"`rho:io:stdout`"+`),
  rl(`+"`rho:registry:lookup`"+`),
  ASIVaultCh, vaultCh, toVaultCh, asiVaultkeyCh, resultCh
in {
  rl!(`+"`rho:rchain:asiVault`"+`, *ASIVaultCh) |
  for (@(_, ASIVault) <- ASIVaultCh) {
    @ASIVault!("findOrCreate", "%s", *vaultCh) |
    @ASIVault!("findOrCreate", "%s", *toVaultCh) |
    @ASIVault!("deployerAuthKey", *deployerId, *asiVaultkeyCh) |
    for (@(true, vault) <- vaultCh; key <- asiVaultkeyCh; @(true, toVault) <- toVaultCh) {
      @vault!("transfer", "%s", %d, *key, *resultCh) |
      for (@result <- resultCh) {
        match result {
          (true, Nil) => { stdout!(("Transfer OK:", %d)) }
          (false, reason) => { stdout!(("Transfer failed:", reason)) }
        }
      }
    }
  }
}`, fromAddr, toAddr, toAddr, amount, amount)
}
