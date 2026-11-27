// Paging shared by every list in the admin panel.
//
//   ?page=2       the page to show
//   ?per_page=10  how many rows a page holds
//   ?all=1        the whole list, unpaged
//
// `all` exists for the forms. A product form fills its category dropdown from
// /categories, and a dropdown silently holding only the first 25 options would
// be a worse bug than the long list paging set out to fix.
const db = require("./db");

const PER_PAGE = 25;

// The sizes a page may be. A fixed set, not any number the query string asks
// for: ?per_page=1000000 is a way to make the server read a whole table into
// memory, and these are the only sizes the panel offers anyway.
const PER_PAGE_CHOICES = [10, 25, 50, 100];

function pageOf(req, total, perPage = PER_PAGE) {
  const all = req.query.all === "1" || req.query.all === "true";
  const asked = parseInt(req.query.per_page, 10);
  const per = PER_PAGE_CHOICES.includes(asked) ? asked : perPage;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = all ? 1 : Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  return {
    all,
    per,
    offset: all ? 0 : (page - 1) * per,
    sql: all ? "" : `LIMIT ${per} OFFSET ${(page - 1) * per}`,
    meta: {
      total, page: all ? 1 : page, pages: all ? 1 : pages,
      per_page: all ? total : per,
    },
  };
}

const countOf = async (sql, params) =>
  parseInt((await db.query(sql, params || [])).rows[0].count, 10);

module.exports = { PER_PAGE, PER_PAGE_CHOICES, pageOf, countOf };
