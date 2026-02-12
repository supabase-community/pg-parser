
// deparseNode: universal per-node deparse dispatcher.
//
// Appended to postgres_deparse.c at build time. All static deparse handlers
// defined above are visible because this code lives in the same translation
// unit. See Makefile patch steps and bindings/patches/README for details.
//
// This variant targets PG 17+ where deparseExpr takes 3 params
// (added DeparseNodeContext) and JSON expression types are expanded.

void deparseNode(StringInfo str, Node *node)
{
	if (node == NULL)
		elog(ERROR, "deparseNode: NULL node");

	switch (nodeTag(node))
	{
		// ---- Clause types (not handled by deparseStmt or deparseExpr) ----

		case T_ResTarget:
		{
			// deparseResTarget is forward-declared but never defined in
			// libpg_query. Inline the SELECT target_list logic: val [AS name].
			ResTarget *rt = castNode(ResTarget, node);
			if (rt->val != NULL)
			{
				deparseExpr(str, rt->val, DEPARSE_NODE_CONTEXT_NONE);
				if (rt->name != NULL)
				{
					appendStringInfoString(str, " AS ");
					appendStringInfoString(str, quote_identifier(rt->name));
				}
			}
			else if (rt->name != NULL)
			{
				appendStringInfoString(str, quote_identifier(rt->name));
			}
			break;
		}
		case T_RangeVar:
			deparseRangeVar(str, castNode(RangeVar, node), DEPARSE_NODE_CONTEXT_NONE);
			break;
		case T_TypeName:
			deparseTypeName(str, castNode(TypeName, node));
			break;
		case T_ColumnDef:
			deparseColumnDef(str, castNode(ColumnDef, node));
			break;
		case T_SortBy:
			deparseSortBy(str, castNode(SortBy, node));
			break;
		case T_WindowDef:
			deparseWindowDef(str, castNode(WindowDef, node));
			break;
		case T_Alias:
			deparseAlias(str, castNode(Alias, node));
			break;
		case T_JoinExpr:
			deparseJoinExpr(str, castNode(JoinExpr, node));
			break;
		case T_CommonTableExpr:
			deparseCommonTableExpr(str, castNode(CommonTableExpr, node));
			break;
		case T_WithClause:
			deparseWithClause(str, castNode(WithClause, node));
			break;
		case T_RangeSubselect:
			deparseRangeSubselect(str, castNode(RangeSubselect, node));
			break;
		case T_RangeFunction:
			deparseRangeFunction(str, castNode(RangeFunction, node));
			break;
		case T_OnConflictClause:
			deparseOnConflictClause(str, castNode(OnConflictClause, node));
			break;
		case T_Constraint:
			deparseConstraint(str, castNode(Constraint, node));
			break;
		case T_IndexElem:
			deparseIndexElem(str, castNode(IndexElem, node));
			break;
		case T_FunctionParameter:
			deparseFunctionParameter(str, castNode(FunctionParameter, node));
			break;
		case T_LockingClause:
			deparseLockingClause(str, castNode(LockingClause, node));
			break;
		case T_GroupingSet:
			deparseGroupingSet(str, castNode(GroupingSet, node));
			break;
		case T_RoleSpec:
			deparseRoleSpec(str, castNode(RoleSpec, node));
			break;
		case T_RangeTableSample:
			deparseRangeTableSample(str, castNode(RangeTableSample, node));
			break;
		case T_RangeTableFunc:
			deparseRangeTableFunc(str, castNode(RangeTableFunc, node));
			break;

		// ---- Expression types (route to deparseExpr which dispatches directly) ----

		case T_ColumnRef:
		case T_A_Const:
		case T_ParamRef:
		case T_A_Indirection:
		case T_CaseExpr:
		case T_SubLink:
		case T_A_ArrayExpr:
		case T_RowExpr:
		case T_GroupingFunc:
		case T_TypeCast:
		case T_CollateClause:
		case T_A_Expr:
		case T_BoolExpr:
		case T_NullTest:
		case T_BooleanTest:
		case T_SetToDefault:
		case T_FuncCall:
		case T_SQLValueFunction:
		case T_MinMaxExpr:
		case T_CoalesceExpr:
		case T_XmlExpr:
		case T_XmlSerialize:
		case T_JsonIsPredicate:
		case T_MergeSupportFunc:
		case T_JsonParseExpr:
		case T_JsonScalarExpr:
		case T_JsonSerializeExpr:
		case T_JsonFuncExpr:
		case T_JsonObjectAgg:
		case T_JsonArrayAgg:
		case T_JsonObjectConstructor:
		case T_JsonArrayConstructor:
		case T_JsonArrayQueryConstructor:
			deparseExpr(str, node, DEPARSE_NODE_CONTEXT_NONE);
			break;

		// ---- Statement types (delegated to deparseStmt's own direct-dispatch switch) ----

		default:
			deparseStmt(str, node);
			break;
	}
}
