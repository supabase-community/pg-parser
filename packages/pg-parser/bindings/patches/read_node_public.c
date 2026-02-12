
// pg_query_protobuf_to_node: public wrapper around static _readNode().
//
// Appended to pg_query_readfuncs_protobuf.c at build time.
// Unpacks a single Node protobuf and converts to an internal PostgreSQL Node*.

Node * pg_query_protobuf_to_node(PgQueryProtobuf protobuf)
{
	PgQuery__Node *proto_node = pg_query__node__unpack(NULL, protobuf.len, (const uint8_t *) protobuf.data);

	if (proto_node == NULL)
		elog(ERROR, "pg_query_protobuf_to_node: failed to unpack protobuf");

	Node *node = _readNode(proto_node);

	pg_query__node__free_unpacked(proto_node, NULL);

	return node;
}
