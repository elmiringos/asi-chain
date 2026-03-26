HELLO_WORLD = """
new stdout(`rho:io:stdout`) in {
  stdout!("Hello, Blockchain!")
}
"""


def transfer(from_addr: str, to_addr: str, amount: int) -> str:
    return f"""
new rl(`rho:registry:lookup`), SystemVaultCh, stdout(`rho:io:stdout`) in {{
  rl!(`rho:rchain:revVault`, *SystemVaultCh) |
  for (@(_, SystemVault) <- SystemVaultCh) {{
    new vaultCh, targetVaultCh, keyCh, deployerId(`rho:system:deployerId`) in {{
      @SystemVault!("findOrCreate", "{from_addr}", *vaultCh) |
      @SystemVault!("findOrCreate", "{to_addr}", *targetVaultCh) |
      @SystemVault!("deployerAuthKey", *deployerId, *keyCh) |
      for (@(true, fromVault) <- vaultCh & key <- keyCh & @(true, _) <- targetVaultCh) {{
        new resultCh in {{
          @fromVault!("transfer", "{to_addr}", {amount}, *key, *resultCh) |
          for (@result <- resultCh) {{
            stdout!(result)
          }}
        }}
      }}
    }}
  }}
}}
"""
