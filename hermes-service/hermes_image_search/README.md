# hermes-image-search

`hermes_image_search` is a small SerpApi Google Images-backed image search package.

It is designed to be reused in two ways:

- imported directly by the backend app
- exposed to Hermes as a plugin tool

The shared entry point is:

```python
from hermes_image_search.service.models import ImageSearchRequest
from hermes_image_search.service.search import search_images

result = search_images(ImageSearchRequest(query="blue lizard on rock"))
```

## Environment

Set `SERPAPI_API_KEY` before calling the package.

## Response shape

The package normalizes SerpApi Google Images results into a stable bundle so the
app route and Hermes tool both return the same structure.
