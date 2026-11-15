// The corner shop's rules, in Cedar's own syntax. The @id is the name the
// request tracer shows; the @description is shown next to it.

@id("same-shop")
@description("A clerk reads the receipts of their own shop.")
permit (principal, action == Action::"read", resource)
when { principal.shop == resource.shop };

@id("managers-void")
@description("Only a manager voids a receipt, and only in their own shop.")
permit (principal, action == Action::"void", resource)
when { principal.manager && principal.shop == resource.shop };

@id("other-shops-are-closed-books")
@description("Nobody touches another shop's receipts, whatever else says they may.")
forbid (principal, action, resource)
unless { principal.shop == resource.shop };
