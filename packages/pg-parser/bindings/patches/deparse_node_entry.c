
// pg_query_deparse_node_protobuf: deparse a single Node from protobuf bytes.
//
// Appended to pg_query_deparse.c at build time.
// Same memory context + PG_TRY/PG_CATCH pattern as pg_query_deparse_protobuf.

PgQueryDeparseResult pg_query_deparse_node_protobuf(PgQueryProtobuf node_protobuf)
{
	PgQueryDeparseResult result = {0};
	StringInfoData str;
	MemoryContext ctx;

	ctx = pg_query_enter_memory_context();

	PG_TRY();
	{
		Node *node = pg_query_protobuf_to_node(node_protobuf);

		initStringInfo(&str);
		deparseNode(&str, node);

		result.query = strdup(str.data);
	}
	PG_CATCH();
	{
		ErrorData* error_data;
		PgQueryError* error;

		MemoryContextSwitchTo(ctx);
		error_data = CopyErrorData();

		// Note: This is intentionally malloc so exiting the memory context doesn't free this
		error = malloc(sizeof(PgQueryError));
		error->message   = strdup(error_data->message);
		error->filename  = strdup(error_data->filename);
		error->funcname  = strdup(error_data->funcname);
		error->context   = NULL;
		error->lineno    = error_data->lineno;
		error->cursorpos = error_data->cursorpos;

		result.error = error;
		FlushErrorState();
	}
	PG_END_TRY();

	pg_query_exit_memory_context(ctx);

	return result;
}
