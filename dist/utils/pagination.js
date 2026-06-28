function parsePagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const sort = typeof query.sort === "string" && query.sort ? query.sort : "createdAt";
  const order = query.order === "asc" ? "asc" : "desc";
  return { page, limit, sort, order };
}
async function paginate(model, filter, opts) {
  const skip = (opts.page - 1) * opts.limit;
  const sortField = { [opts.sort]: opts.order === "asc" ? 1 : -1 };
  const [data, total] = await Promise.all([
    model.find(filter).sort(sortField).skip(skip).limit(opts.limit).lean(),
    model.countDocuments(filter)
  ]);
  return { data, total, page: opts.page, limit: opts.limit };
}
export {
  paginate,
  parsePagination
};
