package main

import (
	"fmt"
	"os"

	"bettersoundcloud/local-api/internal/localapi"
)

func main() {
	if err := localapi.Run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "local backend:", err)
		os.Exit(1)
	}
}
