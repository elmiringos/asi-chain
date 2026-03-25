HELLO_WORLD = """
new stdout(`rho:io:stdout`) in {
  stdout!("Hello, Blockchain!")
}
"""


def transfer(from_addr: str, to_addr: str, amount: int) -> str:
    return f"""
new rl(`rho:registry:lookup`), RevVaultCh, log(`rho:io:stdout`) in {{
  rl!(`rho:rchain:revVault`, *RevVaultCh) |
  for (@(_, RevVault) <- RevVaultCh) {{
    @RevVault!("findOrCreate", "{from_addr}", *log) |
    for (@(true, fromVault) <- log) {{
      @fromVault!("transfer", "{to_addr}", {amount}, *log) |
      for (@result <- log) {{
        log!(result)
      }}
    }}
  }}
}}
"""
