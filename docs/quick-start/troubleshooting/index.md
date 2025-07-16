# Common Errors

## Connection Issues

If your node is unable to connect to the network or fails to synchronize properly, follow the steps below to reset and reinitialize your validator.

### Reset Steps

1. **Stop the running container**

   ```bash
   sudo docker stop <CONTAINER_ID>
   ```

2. **Remove the container**

   ```bash
   sudo docker rm <CONTAINER_ID>
   ```

3. **Delete the local data**
   Navigate to your project directory and delete the `data` folder:

   ```bash
   rm -rf asi-chain/chain/data
   ```

4. **Restart the validator**

   ```bash
   sudo docker compose -f validator.yml up -d
   ```

> [!TIP]
> Always make sure that your `.env`, `validator.yml`, and `conf/validator.conf` files are properly configured before restarting the node.