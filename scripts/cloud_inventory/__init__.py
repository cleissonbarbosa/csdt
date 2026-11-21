"""Collectors that write an AEGIS cloud inventory, and what they share.

`core` holds the inventory being written and the file it becomes; `aws`,
`gcp` and `oci` each fill one from what their provider's CLI answers. They
are tools for the operator, run on the operator's machine with the
operator's own access: AEGIS never runs them, and they only read.
"""
